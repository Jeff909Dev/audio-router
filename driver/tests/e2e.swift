// End-to-end check against the installed driver: plays a 1 kHz tone at -60 dBFS
// into <play-uid> and checks that <record-uid>'s input returns the same level
// and frequency. Sample-exact equality is not checked, because a Multi-Output
// Device resamples the router to follow the main device's clock.
//
//   e2e [play-uid] [record-uid]     both default to AudioRouter2ch_UID
import CoreAudio
import Foundation

func deviceID(_ uid: String) -> AudioObjectID {
    var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyTranslateUIDToDevice,
                                          mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var cf = uid as CFString
    var id = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    _ = withUnsafeMutablePointer(to: &cf) { q in
        AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr,
                                   UInt32(MemoryLayout<CFString>.size), q, &size, &id)
    }
    return id
}

let args = CommandLine.arguments
let playUID = args.count > 1 ? args[1] : "AudioRouter2ch_UID"
let recordUID = args.count > 2 ? args[2] : "AudioRouter2ch_UID"
let play = deviceID(playUID), record = deviceID(recordUID)
guard play != kAudioObjectUnknown, record != kAudioObjectUnknown else {
    print("e2e: device not found (\(playUID) → \(recordUID)). Is the driver installed?")
    exit(2)
}

var rate = Float64(0)
var rateSize = UInt32(MemoryLayout<Float64>.size)
var rateAddr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyNominalSampleRate,
                                          mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
AudioObjectGetPropertyData(record, &rateAddr, 0, nil, &rateSize, &rate)

let amplitude: Float = 0.001
let freq = 1000.0
var phase = 0.0
var peak: Float = 0, crossings = 0, frames = 0, last: Float = 0
let lock = NSLock()
let queue = DispatchQueue(label: "e2e.io")

var outProc: AudioDeviceIOProcID?
AudioDeviceCreateIOProcIDWithBlock(&outProc, play, queue) { _, _, _, outData, _ in
    let start = phase
    for buf in UnsafeMutableAudioBufferListPointer(outData) {
        let ch = Int(buf.mNumberChannels)
        let n = Int(buf.mDataByteSize) / 4 / ch
        let p = buf.mData!.assumingMemoryBound(to: Float.self)
        var ph = start
        for i in 0..<n {
            let s = amplitude * Float(sin(ph))
            for c in 0..<ch { p[i * ch + c] = s }
            ph += 2 * .pi * freq / rate
        }
        phase = ph.truncatingRemainder(dividingBy: 2 * .pi)
    }
}
var inProc: AudioDeviceIOProcID?
AudioDeviceCreateIOProcIDWithBlock(&inProc, record, queue) { _, inData, _, _, _ in
    lock.lock(); defer { lock.unlock() }
    guard let buf = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inData)).first else { return }
    let ch = Int(buf.mNumberChannels)
    let n = Int(buf.mDataByteSize) / 4 / ch
    let p = buf.mData!.assumingMemoryBound(to: Float.self)
    for i in 0..<n {
        let s = p[i * ch]
        peak = max(peak, abs(s))
        if (last < 0) != (s < 0) { crossings += 1 }
        last = s
    }
    frames += n
}

AudioDeviceStart(record, inProc)
AudioDeviceStart(play, outProc)
Thread.sleep(forTimeInterval: 0.5)
lock.lock(); peak = 0; crossings = 0; frames = 0; lock.unlock()
Thread.sleep(forTimeInterval: 2.0)
AudioDeviceStop(play, outProc)
AudioDeviceStop(record, inProc)

lock.lock()
let seconds = Double(frames) / rate
let hz = seconds > 0 ? Double(crossings) / 2 / seconds : 0
print(String(format: "%@ → %@: peak %.5f (want %.5f), %.1f Hz (want %.0f), %.2f s",
             playUID, recordUID, peak, amplitude, hz, freq, seconds))
if peak == 0 { print("e2e: silence. If the terminal has no microphone access, allow it in System Settings › Privacy & Security › Microphone.") }
let pass = abs(peak - amplitude) < amplitude * 0.05 && abs(hz - freq) < 5
print(pass ? "e2e: PASS" : "e2e: FAIL")
exit(pass ? 0 : 1)
