// arctl — tiny CoreAudio CLI used by the Electron app (JSON on stdout).
//
//   arctl list
//   arctl set-default <output|input|system> <device-uid>
//   arctl set-rate <device-uid> <hz>
//   arctl multi-output <listen-uid> <router-uid>
//   arctl remove <multi-output-uid>

import CoreAudio
import Foundation

struct Device: Codable {
    let id: UInt32
    let uid: String
    let name: String
    let manufacturer: String
    let transport: String
    let inputChannels: Int
    let outputChannels: Int
    let sampleRate: Double
    let sampleRates: [Double]
    let isDefaultInput: Bool
    let isDefaultOutput: Bool
    let isDefaultSystemOutput: Bool
}

struct CLIError: Error { let message: String }

func address(_ selector: AudioObjectPropertySelector,
             _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}

func getValue<T: BitwiseCopyable>(_ obj: AudioObjectID, _ selector: AudioObjectPropertySelector, _ initial: T,
                 scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> T? {
    var addr = address(selector, scope)
    var value = initial
    var size = UInt32(MemoryLayout<T>.size)
    let err = withUnsafeMutablePointer(to: &value) { AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, $0) }
    return err == noErr ? value : nil
}

func getArray<T: BitwiseCopyable>(_ obj: AudioObjectID, _ selector: AudioObjectPropertySelector, _ zero: T,
                 scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> [T] {
    var addr = address(selector, scope)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(obj, &addr, 0, nil, &size) == noErr, size > 0 else { return [] }
    var items = [T](repeating: zero, count: Int(size) / MemoryLayout<T>.stride)
    guard AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, &items) == noErr else { return [] }
    return items
}

func getString(_ obj: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String {
    var addr = address(selector)
    var value: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, &value) == noErr, let s = value else { return "" }
    return s.takeRetainedValue() as String
}

func channelCount(_ dev: AudioObjectID, _ scope: AudioObjectPropertyScope) -> Int {
    var addr = address(kAudioDevicePropertyStreamConfiguration, scope)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(dev, &addr, 0, nil, &size) == noErr, size > 0 else { return 0 }
    let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { raw.deallocate() }
    guard AudioObjectGetPropertyData(dev, &addr, 0, nil, &size, raw) == noErr else { return 0 }
    let list = UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self))
    return list.reduce(0) { $0 + Int($1.mNumberChannels) }
}

func transportName(_ t: UInt32) -> String {
    switch t {
    case kAudioDeviceTransportTypeBuiltIn: return "built-in"
    case kAudioDeviceTransportTypeVirtual: return "virtual"
    case kAudioDeviceTransportTypeUSB: return "usb"
    case kAudioDeviceTransportTypeBluetooth, kAudioDeviceTransportTypeBluetoothLE: return "bluetooth"
    case kAudioDeviceTransportTypeAggregate: return "aggregate"
    case kAudioDeviceTransportTypeHDMI, kAudioDeviceTransportTypeDisplayPort: return "display"
    case kAudioDeviceTransportTypeAirPlay: return "airplay"
    case kAudioDeviceTransportTypeThunderbolt: return "thunderbolt"
    default: return "other"
    }
}

let system = AudioObjectID(kAudioObjectSystemObject)

func defaultDevice(_ selector: AudioObjectPropertySelector) -> AudioObjectID {
    getValue(system, selector, AudioObjectID(kAudioObjectUnknown)) ?? AudioObjectID(kAudioObjectUnknown)
}

// Devices report either discrete rates (min == max) or continuous ranges.
let commonRates: [Double] = [44100, 48000, 88200, 96000, 176400, 192000]
func ratesIn(_ r: AudioValueRange) -> [Double] {
    if r.mMinimum == r.mMaximum { return [r.mMinimum] }
    return commonRates.filter { $0 >= r.mMinimum && $0 <= r.mMaximum }
}

func listDevices() -> [Device] {
    let defIn = defaultDevice(kAudioHardwarePropertyDefaultInputDevice)
    let defOut = defaultDevice(kAudioHardwarePropertyDefaultOutputDevice)
    let defSys = defaultDevice(kAudioHardwarePropertyDefaultSystemOutputDevice)
    return getArray(system, kAudioHardwarePropertyDevices, AudioObjectID(0)).map { id in
        let rates = getArray(id, kAudioDevicePropertyAvailableNominalSampleRates, AudioValueRange()).flatMap(ratesIn)
        return Device(
            id: id,
            uid: getString(id, kAudioDevicePropertyDeviceUID),
            name: getString(id, kAudioObjectPropertyName),
            manufacturer: getString(id, kAudioObjectPropertyManufacturer),
            transport: transportName(getValue(id, kAudioDevicePropertyTransportType, UInt32(0)) ?? 0),
            inputChannels: channelCount(id, kAudioObjectPropertyScopeInput),
            outputChannels: channelCount(id, kAudioObjectPropertyScopeOutput),
            sampleRate: getValue(id, kAudioDevicePropertyNominalSampleRate, Float64(0)) ?? 0,
            sampleRates: Array(Set(rates)).sorted(),
            isDefaultInput: id == defIn,
            isDefaultOutput: id == defOut,
            isDefaultSystemOutput: id == defSys
        )
    }
}

func device(withUID uid: String) throws -> Device {
    guard let d = listDevices().first(where: { $0.uid == uid }) else { throw CLIError(message: "no device with uid \(uid)") }
    return d
}

func setValue<T: BitwiseCopyable>(_ obj: AudioObjectID, _ selector: AudioObjectPropertySelector, _ value: T) throws {
    var addr = address(selector)
    var v = value
    let err = AudioObjectSetPropertyData(obj, &addr, 0, nil, UInt32(MemoryLayout<T>.size), &v)
    if err != noErr { throw CLIError(message: "AudioObjectSetPropertyData failed (\(err))") }
}

// A Multi-Output Device is a "stacked" aggregate: what an app plays into it reaches every subdevice.
// `listen` (your headphones) drives the clock; the router follows it with drift compensation.
// The UID is derived from both devices, so asking twice returns the existing device.
let multiPrefix = "AudioRouter.multi."

func multiOutput(listen: Device, router: Device) throws -> Device {
    let uid = "\(multiPrefix)\(listen.uid)+\(router.uid)"
    if let existing = listDevices().first(where: { $0.uid == uid }) { return existing }
    let description: [String: Any] = [
        kAudioAggregateDeviceNameKey: "\(listen.name) + \(router.name)",
        kAudioAggregateDeviceUIDKey: uid,
        kAudioAggregateDeviceIsStackedKey: 1,
        kAudioAggregateDeviceIsPrivateKey: 0,
        kAudioAggregateDeviceMainSubDeviceKey: listen.uid,
        kAudioAggregateDeviceSubDeviceListKey: [
            [kAudioSubDeviceUIDKey: listen.uid],
            [kAudioSubDeviceUIDKey: router.uid, kAudioSubDeviceDriftCompensationKey: 1],
        ],
    ]
    var id = AudioObjectID(kAudioObjectUnknown)
    let err = AudioHardwareCreateAggregateDevice(description as CFDictionary, &id)
    if err != noErr { throw CLIError(message: "could not create the multi-output device (\(err))") }
    // The HAL updates this process's device list through the run loop, so the new device shows up a moment later.
    for _ in 0..<50 {
        if let d = listDevices().first(where: { $0.uid == uid }) { return d }
        CFRunLoopRunInMode(.defaultMode, 0.1, false)
    }
    throw CLIError(message: "created \(uid), but Core Audio has not published it yet")
}

func printJSON<T: Encodable>(_ value: T) {
    let enc = JSONEncoder()
    enc.outputFormatting = [.sortedKeys]
    FileHandle.standardOutput.write(try! enc.encode(value))
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

func run(_ args: [String]) throws {
    switch args.first {
    case "list":
        printJSON(listDevices())
    case "set-default":
        guard args.count == 3 else { throw CLIError(message: "usage: arctl set-default <output|input|system> <uid>") }
        let selector: AudioObjectPropertySelector
        switch args[1] {
        case "output": selector = kAudioHardwarePropertyDefaultOutputDevice
        case "input": selector = kAudioHardwarePropertyDefaultInputDevice
        case "system": selector = kAudioHardwarePropertyDefaultSystemOutputDevice
        default: throw CLIError(message: "unknown default kind \(args[1])")
        }
        try setValue(system, selector, try device(withUID: args[2]).id)
        printJSON(["ok": true])
    case "set-rate":
        guard args.count == 3, let rate = Double(args[2]) else { throw CLIError(message: "usage: arctl set-rate <uid> <hz>") }
        let d = try device(withUID: args[1])
        guard d.sampleRates.contains(rate) else { throw CLIError(message: "\(d.name) does not support \(rate) Hz") }
        try setValue(d.id, kAudioDevicePropertyNominalSampleRate, Float64(rate))
        printJSON(["ok": true])
    case "multi-output":
        guard args.count == 3 else { throw CLIError(message: "usage: arctl multi-output <listen-uid> <router-uid>") }
        let listen = try device(withUID: args[1])
        let router = try device(withUID: args[2])
        // Same rule as listenCandidates in app/src/lib/link.ts: real outputs only (the router itself is virtual).
        guard listen.outputChannels > 0, !["aggregate", "virtual"].contains(listen.transport) else {
            throw CLIError(message: "\(listen.name) can't be used to listen")
        }
        printJSON(try multiOutput(listen: listen, router: router))
    case "remove":
        guard args.count == 2 else { throw CLIError(message: "usage: arctl remove <multi-output-uid>") }
        guard args[1].hasPrefix(multiPrefix) else { throw CLIError(message: "only devices made by arctl multi-output can be removed") }
        if let d = listDevices().first(where: { $0.uid == args[1] }) {
            let err = AudioHardwareDestroyAggregateDevice(d.id)
            if err != noErr { throw CLIError(message: "could not remove \(d.name) (\(err))") }
        }
        printJSON(["ok": true])
    default:
        throw CLIError(message: "usage: arctl <list|set-default|set-rate|multi-output|remove> ...")
    }
}

do {
    try run(Array(CommandLine.arguments.dropFirst()))
} catch let e as CLIError {
    FileHandle.standardError.write("arctl: \(e.message)\n".data(using: .utf8)!)
    exit(1)
}
