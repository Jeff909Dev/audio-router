// loopback_test.c — loads a built AudioRouter*.driver bundle in-process,
// plays the role of coreaudiod (the "host") and checks the device's
// properties, the loopback IO path and sample-rate changes.
//
//   build/loopback_test build/AudioRouter2ch.driver

#include <CoreAudio/AudioServerPlugIn.h>
#include <CoreFoundation/CoreFoundation.h>
#include <mach/mach_time.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int gFailures = 0;
#define CHECK(cond, ...)                                       \
    do {                                                       \
        if (!(cond)) {                                         \
            gFailures++;                                       \
            fprintf(stderr, "  FAIL %s:%d: ", __FILE__, __LINE__); \
            fprintf(stderr, __VA_ARGS__);                      \
            fprintf(stderr, "\n");                             \
        }                                                      \
    } while (0)

// ---- fake host -------------------------------------------------------------

static _Atomic(UInt64) gRequestedChange = 0;

static OSStatus Host_PropertiesChanged(AudioServerPlugInHostRef h, AudioObjectID o, UInt32 n,
                                       const AudioObjectPropertyAddress* a) {
    (void)h; (void)o; (void)n; (void)a;
    return noErr;
}
static OSStatus Host_CopyFromStorage(AudioServerPlugInHostRef h, CFStringRef k, CFPropertyListRef* out) {
    (void)h; (void)k;
    if (out) *out = NULL;
    return noErr;
}
static OSStatus Host_WriteToStorage(AudioServerPlugInHostRef h, CFStringRef k, CFPropertyListRef d) {
    (void)h; (void)k; (void)d;
    return noErr;
}
static OSStatus Host_DeleteFromStorage(AudioServerPlugInHostRef h, CFStringRef k) {
    (void)h; (void)k;
    return noErr;
}
static OSStatus Host_RequestConfigChange(AudioServerPlugInHostRef h, AudioObjectID dev, UInt64 action, void* info) {
    (void)h; (void)dev; (void)info;
    atomic_store(&gRequestedChange, action);
    return noErr;
}

static const AudioServerPlugInHostInterface gHost = {
    Host_PropertiesChanged, Host_CopyFromStorage, Host_WriteToStorage, Host_DeleteFromStorage,
    Host_RequestConfigChange,
};

// ---- helpers ---------------------------------------------------------------

static AudioServerPlugInDriverRef D;
static AudioServerPlugInDriverInterface* I;

static AudioObjectPropertyAddress Addr(AudioObjectPropertySelector sel, AudioObjectPropertyScope scope) {
    AudioObjectPropertyAddress a = {sel, scope, kAudioObjectPropertyElementMain};
    return a;
}

static OSStatus Get(AudioObjectID obj, AudioObjectPropertySelector sel, AudioObjectPropertyScope scope,
                    UInt32 qSize, const void* q, UInt32 capacity, void* out, UInt32* outSize) {
    AudioObjectPropertyAddress a = Addr(sel, scope);
    UInt32 size = 0;
    OSStatus err = I->GetPropertyData(D, obj, 0, &a, qSize, q, capacity, &size, out);
    if (outSize) *outSize = size;
    return err;
}

static UInt32 GetU32(AudioObjectID obj, AudioObjectPropertySelector sel) {
    UInt32 v = 0xDEADBEEF;
    OSStatus err = Get(obj, sel, kAudioObjectPropertyScopeGlobal, 0, NULL, sizeof(v), &v, NULL);
    CHECK(err == noErr, "get '%.4s' on %u -> %d", (char*)&sel, obj, (int)err);
    return v;
}

static Float64 GetRate(AudioObjectID dev) {
    Float64 r = 0;
    OSStatus err = Get(dev, kAudioDevicePropertyNominalSampleRate, kAudioObjectPropertyScopeGlobal, 0, NULL,
                       sizeof(r), &r, NULL);
    CHECK(err == noErr, "get nominal rate -> %d", (int)err);
    return r;
}

static UInt32 CountIDs(AudioObjectID obj, AudioObjectPropertySelector sel, AudioObjectPropertyScope scope) {
    AudioObjectPropertyAddress a = Addr(sel, scope);
    UInt32 size = 0;
    OSStatus err = I->GetPropertyDataSize(D, obj, 0, &a, 0, NULL, &size);
    CHECK(err == noErr, "size of '%.4s' -> %d", (char*)&sel, (int)err);
    return size / sizeof(AudioObjectID);
}

static void DoIO(AudioObjectID dev, AudioObjectID stream, UInt32 op, Float64 sampleTime, UInt32 frames, Float32* buf) {
    AudioServerPlugInIOCycleInfo info;
    memset(&info, 0, sizeof(info));
    info.mInputTime.mSampleTime = sampleTime;
    info.mOutputTime.mSampleTime = sampleTime;
    OSStatus err = I->DoIOOperation(D, dev, stream, 0, op, frames, &info, buf, NULL);
    CHECK(err == noErr, "DoIOOperation(%u) -> %d", op, (int)err);
}

static void Fill(Float32* buf, UInt32 frames, UInt32 ch, float seed) {
    for (UInt32 i = 0; i < frames * ch; i++) buf[i] = seed + (float)i * 1e-4f;
}

static int Equal(const Float32* a, const Float32* b, UInt32 n) { return memcmp(a, b, n * sizeof(Float32)) == 0; }
static int AllZero(const Float32* a, UInt32 n) {
    for (UInt32 i = 0; i < n; i++) if (a[i] != 0.0f) return 0;
    return 1;
}

// ---- test ------------------------------------------------------------------

int main(int argc, char** argv) {
    if (argc != 2) {
        fprintf(stderr, "usage: %s path/to/AudioRouterNch.driver\n", argv[0]);
        return 2;
    }
    const char* path = argv[1];
    const char* tag = strstr(path, "AudioRouter");
    UInt32 expectedChannels = tag ? (UInt32)atoi(tag + strlen("AudioRouter")) : 0;
    printf("%s (expecting %u channels)\n", path, expectedChannels);

    CFURLRef url = CFURLCreateFromFileSystemRepresentation(NULL, (const UInt8*)path, (CFIndex)strlen(path), true);
    CFBundleRef bundle = CFBundleCreate(NULL, url);
    if (!bundle || !CFBundleLoadExecutable(bundle)) {
        fprintf(stderr, "  FAIL could not load bundle\n");
        return 1;
    }
    typedef void* (*Factory)(CFAllocatorRef, CFUUIDRef);
    Factory create = (Factory)CFBundleGetFunctionPointerForName(bundle, CFSTR("AudioRouter_Create"));
    CHECK(create != NULL, "factory symbol AudioRouter_Create not exported");
    if (!create) return 1;

    CHECK(create(NULL, kAudioServerPlugInDriverInterfaceUUID) == NULL, "factory accepted a wrong type UUID");
    D = (AudioServerPlugInDriverRef)create(NULL, kAudioServerPlugInTypeUUID);
    CHECK(D != NULL && *D != NULL, "factory returned NULL");
    if (!D) return 1;
    I = *D;

    void* iface = NULL;
    HRESULT hr = I->QueryInterface(D, CFUUIDGetUUIDBytes(kAudioServerPlugInDriverInterfaceUUID), &iface);
    CHECK(hr == S_OK && iface == D, "QueryInterface(driver interface) -> %d", (int)hr);
    CHECK(I->Initialize(D, &gHost) == noErr, "Initialize failed");

    // -- plug-in object
    AudioObjectID dev = kAudioObjectUnknown;
    UInt32 size = 0;
    OSStatus err = Get(kAudioObjectPlugInObject, kAudioPlugInPropertyDeviceList, kAudioObjectPropertyScopeGlobal, 0,
                       NULL, sizeof(dev), &dev, &size);
    CHECK(err == noErr && size == sizeof(AudioObjectID) && dev != kAudioObjectUnknown, "device list");
    CHECK(GetU32(kAudioObjectPlugInObject, kAudioObjectPropertyClass) == kAudioPlugInClassID, "plug-in class");

    CFStringRef uid = NULL;
    err = Get(dev, kAudioDevicePropertyDeviceUID, kAudioObjectPropertyScopeGlobal, 0, NULL, sizeof(uid), &uid, NULL);
    CHECK(err == noErr && uid != NULL, "device UID");
    AudioObjectID found = kAudioObjectUnknown;
    Get(kAudioObjectPlugInObject, kAudioPlugInPropertyTranslateUIDToDevice, kAudioObjectPropertyScopeGlobal,
        sizeof(uid), &uid, sizeof(found), &found, NULL);
    CHECK(found == dev, "TranslateUIDToDevice(own UID) -> %u", found);
    CFStringRef bogus = CFSTR("not-a-device");
    found = 123;
    Get(kAudioObjectPlugInObject, kAudioPlugInPropertyTranslateUIDToDevice, kAudioObjectPropertyScopeGlobal,
        sizeof(bogus), &bogus, sizeof(found), &found, NULL);
    CHECK(found == kAudioObjectUnknown, "TranslateUIDToDevice(bogus) -> %u", found);

    // -- device object
    CFStringRef name = NULL;
    Get(dev, kAudioObjectPropertyName, kAudioObjectPropertyScopeGlobal, 0, NULL, sizeof(name), &name, NULL);
    CHECK(name && CFStringFind(name, CFSTR("Audio Router"), 0).location != kCFNotFound, "device name");
    CHECK(GetU32(dev, kAudioObjectPropertyClass) == kAudioDeviceClassID, "device class");
    CHECK(GetU32(dev, kAudioDevicePropertyTransportType) == kAudioDeviceTransportTypeVirtual, "transport type");
    CHECK(GetU32(dev, kAudioDevicePropertyDeviceIsAlive) == 1, "alive");
    CHECK(GetU32(dev, kAudioDevicePropertyDeviceIsRunning) == 0, "not running before StartIO");
    CHECK(CountIDs(dev, kAudioDevicePropertyStreams, kAudioObjectPropertyScopeGlobal) == 2, "2 streams (global)");
    CHECK(CountIDs(dev, kAudioDevicePropertyStreams, kAudioObjectPropertyScopeInput) == 1, "1 input stream");
    CHECK(CountIDs(dev, kAudioDevicePropertyStreams, kAudioObjectPropertyScopeOutput) == 1, "1 output stream");
    CHECK(CountIDs(dev, kAudioObjectPropertyControlList, kAudioObjectPropertyScopeGlobal) == 0, "no controls");

    // OwnedObjects honours the class-ID qualifier
    AudioObjectPropertyAddress owned = Addr(kAudioObjectPropertyOwnedObjects, kAudioObjectPropertyScopeGlobal);
    AudioClassID onlyStreams = kAudioStreamClassID, onlyVolume = kAudioVolumeControlClassID;
    I->GetPropertyDataSize(D, dev, 0, &owned, sizeof(onlyStreams), &onlyStreams, &size);
    CHECK(size == 2 * sizeof(AudioObjectID), "owned streams with stream qualifier, got %u bytes", size);
    I->GetPropertyDataSize(D, dev, 0, &owned, sizeof(onlyVolume), &onlyVolume, &size);
    CHECK(size == 0, "owned objects filtered by volume-control qualifier, got %u bytes", size);

    AudioObjectPropertyAddress a = Addr(kAudioDevicePropertyAvailableNominalSampleRates, kAudioObjectPropertyScopeGlobal);
    I->GetPropertyDataSize(D, dev, 0, &a, 0, NULL, &size);
    CHECK(size == 6 * sizeof(AudioValueRange), "6 sample rates, got %u bytes", size);

    a = Addr(kAudioDevicePropertyPreferredChannelLayout, kAudioObjectPropertyScopeOutput);
    I->GetPropertyDataSize(D, dev, 0, &a, 0, NULL, &size);
    AudioChannelLayout* layout = calloc(1, size);
    err = I->GetPropertyData(D, dev, 0, &a, 0, NULL, size, &size, layout);
    CHECK(err == noErr && layout->mNumberChannelDescriptions == expectedChannels, "channel layout");
    free(layout);

    a = Addr('zzzz', kAudioObjectPropertyScopeGlobal);
    CHECK(!I->HasProperty(D, dev, 0, &a), "unknown selector reported as present");
    a = Addr(kAudioDevicePropertyNominalSampleRate, kAudioObjectPropertyScopeGlobal);
    CHECK(I->HasProperty(D, dev, 0, &a), "nominal rate missing");
    Boolean settable = false;
    I->IsPropertySettable(D, dev, 0, &a, &settable);
    CHECK(settable, "nominal rate should be settable");
    a = Addr(kAudioObjectPropertyName, kAudioObjectPropertyScopeGlobal);
    I->IsPropertySettable(D, dev, 0, &a, &settable);
    CHECK(!settable, "name should not be settable");

    // -- streams
    AudioObjectID inStream = 0, outStream = 0;
    Get(dev, kAudioDevicePropertyStreams, kAudioObjectPropertyScopeInput, 0, NULL, sizeof(inStream), &inStream, NULL);
    Get(dev, kAudioDevicePropertyStreams, kAudioObjectPropertyScopeOutput, 0, NULL, sizeof(outStream), &outStream, NULL);
    CHECK(GetU32(inStream, kAudioStreamPropertyDirection) == 1, "input stream direction");
    CHECK(GetU32(outStream, kAudioStreamPropertyDirection) == 0, "output stream direction");
    AudioStreamBasicDescription fmt;
    Get(outStream, kAudioStreamPropertyVirtualFormat, kAudioObjectPropertyScopeGlobal, 0, NULL, sizeof(fmt), &fmt, NULL);
    CHECK(fmt.mChannelsPerFrame == expectedChannels, "stream channels %u", fmt.mChannelsPerFrame);
    CHECK(fmt.mFormatFlags & kAudioFormatFlagIsFloat && fmt.mBitsPerChannel == 32, "float32 format");

    // -- IO: what goes out comes back in
    const UInt32 ch = expectedChannels, frames = 512;
    const UInt32 period = GetU32(dev, kAudioDevicePropertyZeroTimeStampPeriod);
    Float32* out = malloc(frames * ch * sizeof(Float32));
    Float32* in = malloc(frames * ch * sizeof(Float32));

    CHECK(I->StartIO(D, dev, 1) == noErr, "StartIO");
    CHECK(GetU32(dev, kAudioDevicePropertyDeviceIsRunning) == 1, "running after StartIO");

    const Float64 times[] = {1000.0, (Float64)period - 100.0 /* wraps the ring */, -50.0 /* pre-roll */};
    for (unsigned t = 0; t < sizeof(times) / sizeof(times[0]); t++) {
        Fill(out, frames, ch, 0.25f + (float)t);
        DoIO(dev, outStream, kAudioServerPlugInIOOperationWriteMix, times[t], frames, out);
        memset(in, 0xFF, frames * ch * sizeof(Float32));
        DoIO(dev, inStream, kAudioServerPlugInIOOperationReadInput, times[t], frames, in);
        CHECK(Equal(out, in, frames * ch), "loopback mismatch at sample time %.0f", times[t]);
        DoIO(dev, inStream, kAudioServerPlugInIOOperationReadInput, times[t], frames, in);
        CHECK(AllZero(in, frames * ch), "second read at %.0f should be silence (consumed)", times[t]);
    }

    Float64 st = -1;
    UInt64 ht = 0, seed = 0;
    CHECK(I->GetZeroTimeStamp(D, dev, 1, &st, &ht, &seed) == noErr, "GetZeroTimeStamp");
    CHECK(st >= 0 && (UInt64)st % period == 0 && ht <= mach_absolute_time(), "zero timestamp sane");

    CHECK(I->StopIO(D, dev, 1) == noErr, "StopIO");
    CHECK(I->StopIO(D, dev, 1) != noErr, "unbalanced StopIO should fail");

    // -- sample-rate change goes through the host
    Float64 newRate = 96000.0;
    a = Addr(kAudioDevicePropertyNominalSampleRate, kAudioObjectPropertyScopeGlobal);
    CHECK(I->SetPropertyData(D, dev, 0, &a, 0, NULL, sizeof(newRate), &newRate) == noErr, "set rate");
    for (int i = 0; i < 200 && atomic_load(&gRequestedChange) == 0; i++) usleep(10000);
    UInt64 action = atomic_load(&gRequestedChange);
    CHECK(action == 96000, "host got config change request %llu", (unsigned long long)action);
    CHECK(GetRate(dev) == 48000.0, "rate must not change before PerformDeviceConfigurationChange");
    CHECK(I->PerformDeviceConfigurationChange(D, dev, action, NULL) == noErr, "perform change");
    CHECK(GetRate(dev) == 96000.0, "rate after change");
    Float64 badRate = 12345.0;
    CHECK(I->SetPropertyData(D, dev, 0, &a, 0, NULL, sizeof(badRate), &badRate) != noErr, "unsupported rate accepted");

    free(out);
    free(in);
    printf(gFailures ? "  %d FAILURE(S)\n" : "  all checks passed\n", gFailures);
    return gFailures ? 1 : 0;
}
