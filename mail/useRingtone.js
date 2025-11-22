import { Audio } from "expo-av";
import { useRef } from "react";

export default function useRingtone() {
  const soundRef = useRef(null);

  const playRingtone = async () => {
    try {
      // 무음 모드에서도 재생되도록 설정
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      });

      const { sound } = await Audio.Sound.createAsync(
        require("./ringtone.mp3"),
        {
          shouldPlay: true,
          isLooping: true, // ✅ 반복
          volume: 1.0,
        }
      );

      soundRef.current = sound;
    } catch (e) {
      console.error("벨소리 재생 오류:", e);
    }
  };

  const stopRingtone = async () => {
    try {
      if (soundRef.current) {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
    } catch (e) {
      console.error("벨소리 종료 오류:", e);
    }
  };

  return { playRingtone, stopRingtone };
}
