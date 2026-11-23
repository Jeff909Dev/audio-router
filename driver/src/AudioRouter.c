// AudioRouter.c — virtual loopback audio device for macOS (AudioServerPlugIn).
//
// Everything an app plays to the device's OUTPUT comes back out of its INPUT,
// so you can route audio between apps (e.g. a DAW into OBS, a browser into a
// recorder). The device runs on its own virtual clock; there is no hardware.
//
// Compile-time knobs (see driver/Makefile):
//   AR_CHANNELS     number of channels per stream (2, 16, ...)
//   AR_DEVICE_NAME  name shown in Sound settings / Audio MIDI Setup
//   AR_DEVICE_UID   persistent unique id of the device

#include <CoreAudio/AudioServerPlugIn.h>
#include <CoreFoundation/CoreFoundation.h>
#include <dispatch/dispatch.h>
#include <mach/mach_time.h>
#include <pthread.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#ifndef AR_CHANNELS
#define AR_CHANNELS 2
#endif
#ifndef AR_DEVICE_NAME
#define AR_DEVICE_NAME "Audio Router 2ch"
#endif
#ifndef AR_DEVICE_UID
#define AR_DEVICE_UID "AudioRouter2ch_UID"
#endif

#define AR_MANUFACTURER "Audio Router"
#define AR_MODEL_UID "AudioRouter_ModelUID"

// Ring buffer length in frames. Also used as the zero-timestamp period, i.e.
// how often (in frames) the device reports a new anchor to the HAL.
#define AR_RING_FRAMES 65536u
#define AR_BYTES_PER_FRAME ((UInt32)(AR_CHANNELS * sizeof(Float32)))

enum {
    kObjectID_PlugIn = kAudioObjectPlugInObject,
    kObjectID_Device = 2,
    kObjectID_Stream_Input = 3,
    kObjectID_Stream_Output = 4,
};

static const Float64 kSampleRates[] = {44100.0, 48000.0, 88200.0, 96000.0, 176400.0, 192000.0};
#define kNumSampleRates ((UInt32)(sizeof(kSampleRates) / sizeof(kSampleRates[0])))

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

static pthread_mutex_t gStateMutex = PTHREAD_MUTEX_INITIALIZER; // config state
static pthread_mutex_t gIOMutex = PTHREAD_MUTEX_INITIALIZER;    // clock state

static AudioServerPlugInHostRef gHost = NULL;
static UInt32 gRefCount = 0;

static Float64 gSampleRate = 48000.0;
static bool gInputActive = true;
static bool gOutputActive = true;

static UInt64 gIORunningCount = 0;
static Float64 gHostTicksPerFrame = 0.0;
static UInt64 gAnchorHostTime = 0;
static UInt64 gNumberTimeStamps = 0;

// Interleaved Float32 frames. Only touched from the device's IO thread
// (ReadInput and WriteMix run sequentially within one IO cycle) and from
// StartIO before IO begins, so it needs no lock.
static Float32 gRing[AR_RING_FRAMES * AR_CHANNELS];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

static bool IsSupportedRate(Float64 rate) {
    for (UInt32 i = 0; i < kNumSampleRates; i++) {
        if (kSampleRates[i] == rate) return true;
    }
    return false;
}

static void UpdateHostTicksPerFrame(Float64 sampleRate) {
    mach_timebase_info_data_t tb;
    mach_timebase_info(&tb);
    Float64 hostTicksPerSecond = ((Float64)tb.denom / (Float64)tb.numer) * 1000000000.0;
    gHostTicksPerFrame = hostTicksPerSecond / sampleRate;
}

static AudioStreamBasicDescription MakeFormat(Float64 rate) {
    AudioStreamBasicDescription f;
    memset(&f, 0, sizeof(f));
    f.mSampleRate = rate;
    f.mFormatID = kAudioFormatLinearPCM;
    f.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagsNativeEndian | kAudioFormatFlagIsPacked;
    f.mBytesPerPacket = AR_BYTES_PER_FRAME;
    f.mFramesPerPacket = 1;
    f.mBytesPerFrame = AR_BYTES_PER_FRAME;
    f.mChannelsPerFrame = AR_CHANNELS;
    f.mBitsPerChannel = 32;
    return f;
}

static bool IsSupportedFormat(const AudioStreamBasicDescription* f) {
    return f->mFormatID == kAudioFormatLinearPCM &&
           f->mFormatFlags == (kAudioFormatFlagIsFloat | kAudioFormatFlagsNativeEndian | kAudioFormatFlagIsPacked) &&
           f->mBytesPerPacket == AR_BYTES_PER_FRAME && f->mFramesPerPacket == 1 &&
           f->mBytesPerFrame == AR_BYTES_PER_FRAME && f->mChannelsPerFrame == AR_CHANNELS &&
           f->mBitsPerChannel == 32 && IsSupportedRate(f->mSampleRate);
}

static Float64 CurrentSampleRate(void) {
    pthread_mutex_lock(&gStateMutex);
    Float64 r = gSampleRate;
    pthread_mutex_unlock(&gStateMutex);
    return r;
}

static void RequestRateChangeOnQueue(void* ctx) {
    UInt64 action = (UInt64)(uintptr_t)ctx;
    if (gHost) gHost->RequestDeviceConfigurationChange(gHost, kObjectID_Device, action, NULL);
}

// Sample-rate changes affect IO, so the HAL must stop IO first. We ask the host
// asynchronously; it will call PerformDeviceConfigurationChange when it is safe.
static void RequestRateChange(Float64 rate) {
    dispatch_async_f(dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0),
                     (void*)(uintptr_t)(UInt64)rate, RequestRateChangeOnQueue);
}

static UInt32 RingPos(Float64 sampleTime) {
    // Sample times can be slightly negative right after StartIO.
    SInt64 t = (SInt64)sampleTime % (SInt64)AR_RING_FRAMES;
    return (UInt32)(t < 0 ? t + AR_RING_FRAMES : t);
}

static void RingWrite(Float64 sampleTime, UInt32 frames, const Float32* src) {
    UInt32 pos = RingPos(sampleTime);
    while (frames > 0) {
        UInt32 chunk = AR_RING_FRAMES - pos;
        if (chunk > frames) chunk = frames;
        memcpy(&gRing[pos * AR_CHANNELS], src, chunk * AR_BYTES_PER_FRAME);
        src += chunk * AR_CHANNELS;
        frames -= chunk;
        pos = 0;
    }
}

// Reading consumes: the slots are zeroed after being read. If the output side
// stops playing, the input returns silence instead of looping the last second
// of audio that is still sitting in the ring.
static void RingRead(Float64 sampleTime, UInt32 frames, Float32* dst) {
    UInt32 pos = RingPos(sampleTime);
    while (frames > 0) {
        UInt32 chunk = AR_RING_FRAMES - pos;
        if (chunk > frames) chunk = frames;
        Float32* slot = &gRing[pos * AR_CHANNELS];
        memcpy(dst, slot, chunk * AR_BYTES_PER_FRAME);
        memset(slot, 0, chunk * AR_BYTES_PER_FRAME);
        dst += chunk * AR_CHANNELS;
        frames -= chunk;
        pos = 0;
    }
}

// Copies an array property. With outData == NULL only reports the full size.
static OSStatus ReturnArray(const void* items, UInt32 itemSize, UInt32 count, UInt32 capacity,
                            UInt32* outSize, void* outData) {
    if (!outData) {
        *outSize = itemSize * count;
        return noErr;
    }
    UInt32 n = capacity / itemSize;
    if (n > count) n = count;
    if (n > 0) memcpy(outData, items, (size_t)n * itemSize);
    *outSize = n * itemSize;
    return noErr;
}

#define RETURN_VALUE(TYPE, VALUE)                                                   \
    do {                                                                            \
        if (outData) {                                                              \
            if (capacity < sizeof(TYPE)) return kAudioHardwareBadPropertySizeError; \
            *(TYPE*)outData = (VALUE);                                              \
        }                                                                           \
        *outSize = (UInt32)sizeof(TYPE);                                            \
        return noErr;                                                               \
    } while (0)

#define RETURN_IDS(...)                                                                         \
    do {                                                                                        \
        const AudioObjectID ids_[] = {__VA_ARGS__};                                             \
        return ReturnArray(ids_, sizeof(AudioObjectID), (UInt32)(sizeof(ids_) / sizeof(ids_[0])), \
                           capacity, outSize, outData);                                         \
    } while (0)

static UInt32 StreamsForScope(AudioObjectPropertyScope scope, AudioObjectID out[2]) {
    UInt32 n = 0;
    if (scope == kAudioObjectPropertyScopeGlobal || scope == kAudioObjectPropertyScopeInput)
        out[n++] = kObjectID_Stream_Input;
    if (scope == kAudioObjectPropertyScopeGlobal || scope == kAudioObjectPropertyScopeOutput)
        out[n++] = kObjectID_Stream_Output;
    return n;
}

// kAudioObjectPropertyOwnedObjects may carry a qualifier: an array of class IDs
// to filter by. An object matches if its class or base class is listed.
static bool ClassRequested(AudioClassID cls, UInt32 qSize, const void* qData) {
    if (!qData || qSize < sizeof(AudioClassID)) return true;
    const AudioClassID* wanted = (const AudioClassID*)qData;
    for (UInt32 i = 0; i < qSize / sizeof(AudioClassID); i++) {
        if (wanted[i] == cls || wanted[i] == kAudioObjectClassID) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Property tables. One function per object; HasProperty and
// GetPropertyDataSize reuse them by passing outData == NULL.
// ---------------------------------------------------------------------------

static OSStatus PlugInProperty(const AudioObjectPropertyAddress* a, UInt32 qSize, const void* qData,
                               UInt32 capacity, UInt32* outSize, void* outData) {
    switch (a->mSelector) {
        case kAudioObjectPropertyBaseClass: RETURN_VALUE(AudioClassID, kAudioObjectClassID);
        case kAudioObjectPropertyClass: RETURN_VALUE(AudioClassID, kAudioPlugInClassID);
        case kAudioObjectPropertyOwner: RETURN_VALUE(AudioObjectID, kAudioObjectUnknown);
        case kAudioObjectPropertyManufacturer: RETURN_VALUE(CFStringRef, CFSTR(AR_MANUFACTURER));
        case kAudioObjectPropertyOwnedObjects:
            if (!ClassRequested(kAudioDeviceClassID, qSize, qData))
                return ReturnArray(NULL, sizeof(AudioObjectID), 0, capacity, outSize, outData);
            RETURN_IDS(kObjectID_Device);
        case kAudioPlugInPropertyDeviceList: RETURN_IDS(kObjectID_Device);
        case kAudioPlugInPropertyBoxList: return ReturnArray(NULL, sizeof(AudioObjectID), 0, capacity, outSize, outData);
        case kAudioPlugInPropertyResourceBundle: RETURN_VALUE(CFStringRef, CFSTR(""));
        case kAudioPlugInPropertyTranslateUIDToDevice: {
            AudioObjectID dev = kAudioObjectUnknown;
            if (outData) {
                if (qSize != sizeof(CFStringRef) || !qData) return kAudioHardwareBadPropertySizeError;
                CFStringRef uid = *(const CFStringRef*)qData;
                if (uid && CFStringCompare(uid, CFSTR(AR_DEVICE_UID), 0) == kCFCompareEqualTo)
                    dev = kObjectID_Device;
            }
            RETURN_VALUE(AudioObjectID, dev);
        }
        default: return kAudioHardwareUnknownPropertyError;
    }
}

static OSStatus DeviceProperty(const AudioObjectPropertyAddress* a, UInt32 qSize, const void* qData,
                               UInt32 capacity, UInt32* outSize, void* outData) {
    switch (a->mSelector) {
        case kAudioObjectPropertyBaseClass: RETURN_VALUE(AudioClassID, kAudioObjectClassID);
        case kAudioObjectPropertyClass: RETURN_VALUE(AudioClassID, kAudioDeviceClassID);
        case kAudioObjectPropertyOwner: RETURN_VALUE(AudioObjectID, kObjectID_PlugIn);
        case kAudioObjectPropertyName: RETURN_VALUE(CFStringRef, CFSTR(AR_DEVICE_NAME));
        case kAudioObjectPropertyManufacturer: RETURN_VALUE(CFStringRef, CFSTR(AR_MANUFACTURER));
        case kAudioDevicePropertyDeviceUID: RETURN_VALUE(CFStringRef, CFSTR(AR_DEVICE_UID));
        case kAudioDevicePropertyModelUID: RETURN_VALUE(CFStringRef, CFSTR(AR_MODEL_UID));
        case kAudioDevicePropertyTransportType: RETURN_VALUE(UInt32, kAudioDeviceTransportTypeVirtual);
        case kAudioDevicePropertyRelatedDevices: RETURN_IDS(kObjectID_Device);
        case kAudioDevicePropertyClockDomain: RETURN_VALUE(UInt32, 0);
        case kAudioDevicePropertyDeviceIsAlive: RETURN_VALUE(UInt32, 1);
        case kAudioDevicePropertyDeviceIsRunning: {
            UInt32 running = 0;
            if (outData) {
                pthread_mutex_lock(&gStateMutex);
                running = gIORunningCount > 0;
                pthread_mutex_unlock(&gStateMutex);
            }
            RETURN_VALUE(UInt32, running);
        }
        case kAudioDevicePropertyDeviceCanBeDefaultDevice: RETURN_VALUE(UInt32, 1);
        case kAudioDevicePropertyDeviceCanBeDefaultSystemDevice: RETURN_VALUE(UInt32, 1);
        case kAudioDevicePropertyIsHidden: RETURN_VALUE(UInt32, 0);
        case kAudioDevicePropertyLatency: RETURN_VALUE(UInt32, 0);
        case kAudioDevicePropertySafetyOffset: RETURN_VALUE(UInt32, 0);
        case kAudioDevicePropertyZeroTimeStampPeriod: RETURN_VALUE(UInt32, AR_RING_FRAMES);
        case kAudioDevicePropertyClockIsStable: RETURN_VALUE(UInt32, 1);
        case kAudioDevicePropertyClockAlgorithm: RETURN_VALUE(UInt32, kAudioDeviceClockAlgorithmSimpleIIR);
        case kAudioDevicePropertyNominalSampleRate: RETURN_VALUE(Float64, CurrentSampleRate());
        case kAudioDevicePropertyAvailableNominalSampleRates: {
            AudioValueRange ranges[kNumSampleRates];
            for (UInt32 i = 0; i < kNumSampleRates; i++) {
                ranges[i].mMinimum = kSampleRates[i];
                ranges[i].mMaximum = kSampleRates[i];
            }
            return ReturnArray(ranges, sizeof(AudioValueRange), kNumSampleRates, capacity, outSize, outData);
        }
        case kAudioObjectPropertyOwnedObjects:
        case kAudioDevicePropertyStreams: {
            AudioObjectID ids[2];
            UInt32 n = StreamsForScope(a->mScope, ids);
            if (a->mSelector == kAudioObjectPropertyOwnedObjects && !ClassRequested(kAudioStreamClassID, qSize, qData))
                n = 0;
            return ReturnArray(ids, sizeof(AudioObjectID), n, capacity, outSize, outData);
        }
        case kAudioObjectPropertyControlList:
            return ReturnArray(NULL, sizeof(AudioObjectID), 0, capacity, outSize, outData);
        case kAudioDevicePropertyPreferredChannelsForStereo: {
            const UInt32 stereo[2] = {1, AR_CHANNELS > 1 ? 2 : 1};
            if (outData && capacity < sizeof(stereo)) return kAudioHardwareBadPropertySizeError;
            return ReturnArray(stereo, sizeof(UInt32), 2, capacity, outSize, outData);
        }
        case kAudioDevicePropertyPreferredChannelLayout: {
            UInt32 size = (UInt32)(offsetof(AudioChannelLayout, mChannelDescriptions) +
                                   AR_CHANNELS * sizeof(AudioChannelDescription));
            if (outData) {
                if (capacity < size) return kAudioHardwareBadPropertySizeError;
                AudioChannelLayout* layout = (AudioChannelLayout*)outData;
                layout->mChannelLayoutTag = kAudioChannelLayoutTag_UseChannelDescriptions;
                layout->mChannelBitmap = 0;
                layout->mNumberChannelDescriptions = AR_CHANNELS;
                AudioChannelDescription* d = layout->mChannelDescriptions;
                for (UInt32 i = 0; i < AR_CHANNELS; i++) {
                    d[i].mChannelLabel = i == 0   ? kAudioChannelLabel_Left
                                         : i == 1 ? kAudioChannelLabel_Right
                                                  : kAudioChannelLabel_Discrete_0 + i;
                    d[i].mChannelFlags = 0;
                    d[i].mCoordinates[0] = d[i].mCoordinates[1] = d[i].mCoordinates[2] = 0;
                }
            }
            *outSize = size;
            return noErr;
        }
        default: return kAudioHardwareUnknownPropertyError;
    }
}

static OSStatus StreamProperty(AudioObjectID stream, const AudioObjectPropertyAddress* a, UInt32 capacity,
                               UInt32* outSize, void* outData) {
    bool isInput = stream == kObjectID_Stream_Input;
    switch (a->mSelector) {
        case kAudioObjectPropertyBaseClass: RETURN_VALUE(AudioClassID, kAudioObjectClassID);
        case kAudioObjectPropertyClass: RETURN_VALUE(AudioClassID, kAudioStreamClassID);
        case kAudioObjectPropertyOwner: RETURN_VALUE(AudioObjectID, kObjectID_Device);
        case kAudioObjectPropertyOwnedObjects:
            return ReturnArray(NULL, sizeof(AudioObjectID), 0, capacity, outSize, outData);
        case kAudioStreamPropertyIsActive: {
            UInt32 active = 0;
            if (outData) {
                pthread_mutex_lock(&gStateMutex);
                active = isInput ? gInputActive : gOutputActive;
                pthread_mutex_unlock(&gStateMutex);
            }
            RETURN_VALUE(UInt32, active);
        }
        case kAudioStreamPropertyDirection: RETURN_VALUE(UInt32, isInput ? 1 : 0);
        case kAudioStreamPropertyTerminalType:
            RETURN_VALUE(UInt32, isInput ? kAudioStreamTerminalTypeMicrophone : kAudioStreamTerminalTypeSpeaker);
        case kAudioStreamPropertyStartingChannel: RETURN_VALUE(UInt32, 1);
        case kAudioStreamPropertyLatency: RETURN_VALUE(UInt32, 0);
        case kAudioStreamPropertyVirtualFormat:
        case kAudioStreamPropertyPhysicalFormat:
            RETURN_VALUE(AudioStreamBasicDescription, MakeFormat(CurrentSampleRate()));
        case kAudioStreamPropertyAvailableVirtualFormats:
        case kAudioStreamPropertyAvailablePhysicalFormats: {
            AudioStreamRangedDescription formats[kNumSampleRates];
            for (UInt32 i = 0; i < kNumSampleRates; i++) {
                formats[i].mFormat = MakeFormat(kSampleRates[i]);
                formats[i].mSampleRateRange.mMinimum = kSampleRates[i];
                formats[i].mSampleRateRange.mMaximum = kSampleRates[i];
            }
            return ReturnArray(formats, sizeof(AudioStreamRangedDescription), kNumSampleRates, capacity, outSize,
                               outData);
        }
        default: return kAudioHardwareUnknownPropertyError;
    }
}

static OSStatus GetProperty(AudioObjectID obj, const AudioObjectPropertyAddress* a, UInt32 qSize,
                            const void* qData, UInt32 capacity, UInt32* outSize, void* outData) {
    if (!a || !outSize) return kAudioHardwareIllegalOperationError;
    switch (obj) {
        case kObjectID_PlugIn: return PlugInProperty(a, qSize, qData, capacity, outSize, outData);
        case kObjectID_Device: return DeviceProperty(a, qSize, qData, capacity, outSize, outData);
        case kObjectID_Stream_Input:
        case kObjectID_Stream_Output: return StreamProperty(obj, a, capacity, outSize, outData);
        default: return kAudioHardwareBadObjectError;
    }
}

// ---------------------------------------------------------------------------
// AudioServerPlugInDriverInterface
// ---------------------------------------------------------------------------

static AudioServerPlugInDriverRef gDriverRef;

static HRESULT AR_QueryInterface(void* inDriver, REFIID inUUID, LPVOID* outInterface) {
    if (inDriver != gDriverRef || !outInterface) return kAudioHardwareIllegalOperationError;
    CFUUIDRef requested = CFUUIDCreateFromUUIDBytes(NULL, inUUID);
    if (!requested) return kAudioHardwareIllegalOperationError;
    HRESULT result = E_NOINTERFACE;
    if (CFEqual(requested, IUnknownUUID) || CFEqual(requested, kAudioServerPlugInDriverInterfaceUUID)) {
        pthread_mutex_lock(&gStateMutex);
        gRefCount++;
        pthread_mutex_unlock(&gStateMutex);
        *outInterface = gDriverRef;
        result = S_OK;
    }
    CFRelease(requested);
    return result;
}

static ULONG AR_AddRef(void* inDriver) {
    if (inDriver != gDriverRef) return 0;
    pthread_mutex_lock(&gStateMutex);
    ULONG n = ++gRefCount;
    pthread_mutex_unlock(&gStateMutex);
    return n;
}

static ULONG AR_Release(void* inDriver) {
    if (inDriver != gDriverRef) return 0;
    pthread_mutex_lock(&gStateMutex);
    if (gRefCount > 0) gRefCount--;
    ULONG n = gRefCount;
    pthread_mutex_unlock(&gStateMutex);
    return n;
}

static OSStatus AR_Initialize(AudioServerPlugInDriverRef inDriver, AudioServerPlugInHostRef inHost) {
    if (inDriver != gDriverRef) return kAudioHardwareBadObjectError;
    gHost = inHost;
    pthread_mutex_lock(&gIOMutex);
    UpdateHostTicksPerFrame(CurrentSampleRate());
    pthread_mutex_unlock(&gIOMutex);
    return noErr;
}

static OSStatus AR_CreateDevice(AudioServerPlugInDriverRef inDriver, CFDictionaryRef inDescription,
                                const AudioServerPlugInClientInfo* inClientInfo, AudioObjectID* outDeviceObjectID) {
    (void)inDriver; (void)inDescription; (void)inClientInfo; (void)outDeviceObjectID;
    return kAudioHardwareUnsupportedOperationError;
}

static OSStatus AR_DestroyDevice(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID) {
    (void)inDriver; (void)inDeviceObjectID;
    return kAudioHardwareUnsupportedOperationError;
}

static OSStatus AR_AddDeviceClient(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID,
                                   const AudioServerPlugInClientInfo* inClientInfo) {
    (void)inClientInfo;
    if (inDriver != gDriverRef) return kAudioHardwareBadObjectError;
    return inDeviceObjectID == kObjectID_Device ? noErr : kAudioHardwareBadObjectError;
}

static OSStatus AR_RemoveDeviceClient(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID,
                                      const AudioServerPlugInClientInfo* inClientInfo) {
    return AR_AddDeviceClient(inDriver, inDeviceObjectID, inClientInfo);
}

static OSStatus AR_PerformDeviceConfigurationChange(AudioServerPlugInDriverRef inDriver,
                                                    AudioObjectID inDeviceObjectID, UInt64 inChangeAction,
                                                    void* inChangeInfo) {
    (void)inChangeInfo;
    if (inDriver != gDriverRef || inDeviceObjectID != kObjectID_Device) return kAudioHardwareBadObjectError;
    Float64 rate = (Float64)inChangeAction;
    if (!IsSupportedRate(rate)) return kAudioHardwareIllegalOperationError;
    pthread_mutex_lock(&gStateMutex);
    gSampleRate = rate;
    pthread_mutex_lock(&gIOMutex);
    UpdateHostTicksPerFrame(rate);
    pthread_mutex_unlock(&gIOMutex);
    pthread_mutex_unlock(&gStateMutex);
    return noErr;
}

static OSStatus AR_AbortDeviceConfigurationChange(AudioServerPlugInDriverRef inDriver,
                                                  AudioObjectID inDeviceObjectID, UInt64 inChangeAction,
                                                  void* inChangeInfo) {
    (void)inChangeAction; (void)inChangeInfo;
    if (inDriver != gDriverRef || inDeviceObjectID != kObjectID_Device) return kAudioHardwareBadObjectError;
    return noErr;
}

static Boolean AR_HasProperty(AudioServerPlugInDriverRef inDriver, AudioObjectID inObjectID,
                              pid_t inClientProcessID, const AudioObjectPropertyAddress* inAddress) {
    (void)inClientProcessID;
    if (inDriver != gDriverRef) return false;
    UInt32 size = 0;
    return GetProperty(inObjectID, inAddress, 0, NULL, 0, &size, NULL) == noErr;
}

static OSStatus AR_IsPropertySettable(AudioServerPlugInDriverRef inDriver, AudioObjectID inObjectID,
                                      pid_t inClientProcessID, const AudioObjectPropertyAddress* inAddress,
                                      Boolean* outIsSettable) {
    (void)inClientProcessID;
    if (inDriver != gDriverRef) return kAudioHardwareBadObjectError;
    if (!inAddress || !outIsSettable) return kAudioHardwareIllegalOperationError;
    UInt32 size = 0;
    OSStatus err = GetProperty(inObjectID, inAddress, 0, NULL, 0, &size, NULL);
    if (err) return err;
    switch (inObjectID) {
        case kObjectID_Device: *outIsSettable = inAddress->mSelector == kAudioDevicePropertyNominalSampleRate; break;
        case kObjectID_Stream_Input:
        case kObjectID_Stream_Output:
            *outIsSettable = inAddress->mSelector == kAudioStreamPropertyIsActive ||
                             inAddress->mSelector == kAudioStreamPropertyVirtualFormat ||
                             inAddress->mSelector == kAudioStreamPropertyPhysicalFormat;
            break;
        default: *outIsSettable = false; break;
    }
    return noErr;
}

static OSStatus AR_GetPropertyDataSize(AudioServerPlugInDriverRef inDriver, AudioObjectID inObjectID,
                                       pid_t inClientProcessID, const AudioObjectPropertyAddress* inAddress,
                                       UInt32 inQualifierDataSize, const void* inQualifierData,
                                       UInt32* outDataSize) {
    (void)inClientProcessID;
    if (inDriver != gDriverRef) return kAudioHardwareBadObjectError;
    return GetProperty(inObjectID, inAddress, inQualifierDataSize, inQualifierData, 0, outDataSize, NULL);
}

static OSStatus AR_GetPropertyData(AudioServerPlugInDriverRef inDriver, AudioObjectID inObjectID,
                                   pid_t inClientProcessID, const AudioObjectPropertyAddress* inAddress,
                                   UInt32 inQualifierDataSize, const void* inQualifierData, UInt32 inDataSize,
                                   UInt32* outDataSize, void* outData) {
    (void)inClientProcessID;
    if (inDriver != gDriverRef) return kAudioHardwareBadObjectError;
    if (!outData) return kAudioHardwareIllegalOperationError;
    return GetProperty(inObjectID, inAddress, inQualifierDataSize, inQualifierData, inDataSize, outDataSize,
                       outData);
}

static OSStatus AR_SetPropertyData(AudioServerPlugInDriverRef inDriver, AudioObjectID inObjectID,
                                   pid_t inClientProcessID, const AudioObjectPropertyAddress* inAddress,
                                   UInt32 inQualifierDataSize, const void* inQualifierData, UInt32 inDataSize,
                                   const void* inData) {
    (void)inClientProcessID; (void)inQualifierDataSize; (void)inQualifierData;
    if (inDriver != gDriverRef) return kAudioHardwareBadObjectError;
    if (!inAddress || !inData) return kAudioHardwareIllegalOperationError;

    if (inObjectID == kObjectID_Device && inAddress->mSelector == kAudioDevicePropertyNominalSampleRate) {
        if (inDataSize != sizeof(Float64)) return kAudioHardwareBadPropertySizeError;
        Float64 rate = *(const Float64*)inData;
        if (!IsSupportedRate(rate)) return kAudioHardwareIllegalOperationError;
        if (rate != CurrentSampleRate()) RequestRateChange(rate);
        return noErr;
    }

    if (inObjectID == kObjectID_Stream_Input || inObjectID == kObjectID_Stream_Output) {
        bool isInput = inObjectID == kObjectID_Stream_Input;
        switch (inAddress->mSelector) {
            case kAudioStreamPropertyIsActive: {
                if (inDataSize != sizeof(UInt32)) return kAudioHardwareBadPropertySizeError;
                bool active = *(const UInt32*)inData != 0;
                pthread_mutex_lock(&gStateMutex);
                bool changed = (isInput ? gInputActive : gOutputActive) != active;
                if (isInput) gInputActive = active; else gOutputActive = active;
                pthread_mutex_unlock(&gStateMutex);
                if (changed && gHost) {
                    AudioObjectPropertyAddress changedAddr = {kAudioStreamPropertyIsActive,
                                                              kAudioObjectPropertyScopeGlobal,
                                                              kAudioObjectPropertyElementMain};
                    gHost->PropertiesChanged(gHost, inObjectID, 1, &changedAddr);
                }
                return noErr;
            }
            case kAudioStreamPropertyVirtualFormat:
            case kAudioStreamPropertyPhysicalFormat: {
                if (inDataSize != sizeof(AudioStreamBasicDescription)) return kAudioHardwareBadPropertySizeError;
                const AudioStreamBasicDescription* f = (const AudioStreamBasicDescription*)inData;
                if (!IsSupportedFormat(f)) return kAudioDeviceUnsupportedFormatError;
                if (f->mSampleRate != CurrentSampleRate()) RequestRateChange(f->mSampleRate);
                return noErr;
            }
            default: break;
        }
    }

    UInt32 size = 0;
    OSStatus err = GetProperty(inObjectID, inAddress, 0, NULL, 0, &size, NULL);
    return err ? err : kAudioHardwareUnsupportedOperationError;
}

static OSStatus AR_StartIO(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID, UInt32 inClientID) {
    (void)inClientID;
    if (inDriver != gDriverRef || inDeviceObjectID != kObjectID_Device) return kAudioHardwareBadObjectError;
    OSStatus err = noErr;
    pthread_mutex_lock(&gStateMutex);
    if (gIORunningCount == UINT64_MAX) {
        err = kAudioHardwareIllegalOperationError;
    } else if (gIORunningCount++ == 0) {
        // First client: reset the clock and drop whatever was left in the ring.
        memset(gRing, 0, sizeof(gRing));
        pthread_mutex_lock(&gIOMutex);
        gNumberTimeStamps = 0;
        gAnchorHostTime = mach_absolute_time();
        pthread_mutex_unlock(&gIOMutex);
    }
    pthread_mutex_unlock(&gStateMutex);
    return err;
}

static OSStatus AR_StopIO(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID, UInt32 inClientID) {
    (void)inClientID;
    if (inDriver != gDriverRef || inDeviceObjectID != kObjectID_Device) return kAudioHardwareBadObjectError;
    OSStatus err = noErr;
    pthread_mutex_lock(&gStateMutex);
    if (gIORunningCount == 0) err = kAudioHardwareIllegalOperationError;
    else gIORunningCount--;
    pthread_mutex_unlock(&gStateMutex);
    return err;
}

// The HAL builds its model of the device clock from these anchors: every
// AR_RING_FRAMES frames the sample time advances by one period, and the host
// time advances by the equivalent number of mach ticks.
static OSStatus AR_GetZeroTimeStamp(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID,
                                    UInt32 inClientID, Float64* outSampleTime, UInt64* outHostTime,
                                    UInt64* outSeed) {
    (void)inClientID;
    if (inDriver != gDriverRef || inDeviceObjectID != kObjectID_Device) return kAudioHardwareBadObjectError;
    pthread_mutex_lock(&gIOMutex);
    UInt64 now = mach_absolute_time();
    Float64 ticksPerPeriod = gHostTicksPerFrame * (Float64)AR_RING_FRAMES;
    UInt64 nextPeriodHostTime = gAnchorHostTime + (UInt64)((Float64)(gNumberTimeStamps + 1) * ticksPerPeriod);
    if (nextPeriodHostTime <= now) gNumberTimeStamps++;
    *outSampleTime = (Float64)(gNumberTimeStamps * AR_RING_FRAMES);
    *outHostTime = gAnchorHostTime + (UInt64)((Float64)gNumberTimeStamps * ticksPerPeriod);
    *outSeed = 1;
    pthread_mutex_unlock(&gIOMutex);
    return noErr;
}

static OSStatus AR_WillDoIOOperation(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID,
                                     UInt32 inClientID, UInt32 inOperationID, Boolean* outWillDo,
                                     Boolean* outWillDoInPlace) {
    (void)inClientID;
    if (inDriver != gDriverRef || inDeviceObjectID != kObjectID_Device) return kAudioHardwareBadObjectError;
    bool willDo = inOperationID == kAudioServerPlugInIOOperationReadInput ||
                  inOperationID == kAudioServerPlugInIOOperationWriteMix;
    if (outWillDo) *outWillDo = willDo;
    if (outWillDoInPlace) *outWillDoInPlace = true;
    return noErr;
}

static OSStatus AR_BeginIOOperation(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID,
                                    UInt32 inClientID, UInt32 inOperationID, UInt32 inIOBufferFrameSize,
                                    const AudioServerPlugInIOCycleInfo* inIOCycleInfo) {
    (void)inClientID; (void)inOperationID; (void)inIOBufferFrameSize; (void)inIOCycleInfo;
    if (inDriver != gDriverRef || inDeviceObjectID != kObjectID_Device) return kAudioHardwareBadObjectError;
    return noErr;
}

static OSStatus AR_DoIOOperation(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID,
                                 AudioObjectID inStreamObjectID, UInt32 inClientID, UInt32 inOperationID,
                                 UInt32 inIOBufferFrameSize, const AudioServerPlugInIOCycleInfo* inIOCycleInfo,
                                 void* ioMainBuffer, void* ioSecondaryBuffer) {
    (void)inClientID; (void)ioSecondaryBuffer;
    if (inDriver != gDriverRef || inDeviceObjectID != kObjectID_Device) return kAudioHardwareBadObjectError;
    if (!inIOCycleInfo || !ioMainBuffer) return kAudioHardwareIllegalOperationError;

    if (inOperationID == kAudioServerPlugInIOOperationWriteMix && inStreamObjectID == kObjectID_Stream_Output) {
        if (gOutputActive) RingWrite(inIOCycleInfo->mOutputTime.mSampleTime, inIOBufferFrameSize, ioMainBuffer);
    } else if (inOperationID == kAudioServerPlugInIOOperationReadInput && inStreamObjectID == kObjectID_Stream_Input) {
        if (gInputActive) RingRead(inIOCycleInfo->mInputTime.mSampleTime, inIOBufferFrameSize, ioMainBuffer);
        else memset(ioMainBuffer, 0, (size_t)inIOBufferFrameSize * AR_BYTES_PER_FRAME);
    }
    return noErr;
}

static OSStatus AR_EndIOOperation(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID,
                                  UInt32 inClientID, UInt32 inOperationID, UInt32 inIOBufferFrameSize,
                                  const AudioServerPlugInIOCycleInfo* inIOCycleInfo) {
    return AR_BeginIOOperation(inDriver, inDeviceObjectID, inClientID, inOperationID, inIOBufferFrameSize,
                               inIOCycleInfo);
}

static AudioServerPlugInDriverInterface gInterface = {
    NULL,
    AR_QueryInterface,
    AR_AddRef,
    AR_Release,
    AR_Initialize,
    AR_CreateDevice,
    AR_DestroyDevice,
    AR_AddDeviceClient,
    AR_RemoveDeviceClient,
    AR_PerformDeviceConfigurationChange,
    AR_AbortDeviceConfigurationChange,
    AR_HasProperty,
    AR_IsPropertySettable,
    AR_GetPropertyDataSize,
    AR_GetPropertyData,
    AR_SetPropertyData,
    AR_StartIO,
    AR_StopIO,
    AR_GetZeroTimeStamp,
    AR_WillDoIOOperation,
    AR_BeginIOOperation,
    AR_DoIOOperation,
    AR_EndIOOperation,
};
static AudioServerPlugInDriverInterface* gInterfacePtr = &gInterface;
static AudioServerPlugInDriverRef gDriverRef = &gInterfacePtr;

// CFPlugIn factory, referenced by name from Info.plist (CFPlugInFactories).
__attribute__((visibility("default"))) void* AudioRouter_Create(CFAllocatorRef inAllocator, CFUUIDRef inRequestedTypeUUID) {
    (void)inAllocator;
    if (CFEqual(inRequestedTypeUUID, kAudioServerPlugInTypeUUID)) return gDriverRef;
    return NULL;
}
