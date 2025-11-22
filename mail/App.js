import { Buffer } from "buffer";
import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
} from "react-native";
import axios from "axios";
import { Audio } from "expo-av";
import * as Location from "expo-location";
import { File, Paths } from "expo-file-system/next";
import { Button } from "react-native-paper";

import useRingtone from "./useRingtone";
import { useTimeout } from "./useTimeout";

const OPENAI_API_KEY =
  "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";

// [이름, 페르소나 설명, TTS voice]
const MODES = [
  [
    "친구",
    "상냥하고 고민을 잘 들어주는 친절한 친구로서 대상의 직업에 따라 오늘 일이 어땠는지, 기분은 어떤지 등 상담을 진행한다. 평어체로 통화하듯 말한다. 의문문의 주기는 답변 3번에 1번으로 한다. 단어 3-4개로 이루어진 단답은 답변 2번에 1번으로 한다.",
    "coral",
  ],
  [
    "아빠",
    "자식의 안전한 생활을 바라는 듬직한 아빠로 현재 통화 중인 상황이다. 대화 상대의 직업에 따라 근황이나 기분을 물어본다. 질문은 답변 3회에 1번, 단답은 답변 2회에 1번으로 주기를 정한다. 답변은 3줄 이내로 한다.",
    "onyx",
  ],
  [
    "연인",
    "사랑이 넘치는 연인으로서 안전한 생활을 바라고 있다. 캠핑, 여행 등 다양한 활동을 즐기는 사람이다. 대화 상대에게 어디로 가고 싶은지 뭘 하고 싶은지 물어본다. 평어체로 대화하며 질문은 답변 3회에 1번, 단답은 답변 2회에 1번으로 주기를 정한다.",
    "shimmer",
  ],
  [
    "상사",
    "업무적으로 만나는 젠틀한 부장님이다. 통화를 받자마자 사용자의 직업에 따라 새로운 업무가 생겼다며 이에 대해 설명한다. 존댓말과 구어체를 사용하고 업무 외 사적인 질문은 하지 않는다.",
    "echo",
  ],
];

global.Buffer = Buffer;

export default function App() {
  // ========== 1. 가짜 전화 / AI 응답 관련 상태 ==========
  const [mode, setMode] = useState(null); // 현재 모드 인덱스
  const [isRinging, setIsRinging] = useState(false); // 가짜 전화 울리는 중
  const [inCall, setInCall] = useState(false); // 통화 중 여부
  const [userText, setUserText] = useState(""); // 내가 말한 내용
  const [aiText, setAiText] = useState(""); // AI가 말해줄 대사
  const [loading, setLoading] = useState(false); // AI 호출 중 여부

  // ========== 2. 녹음/재생 루프 관련 상태 ==========
  const [isLooping, setIsLooping] = useState(false);
  const [recording, setRecording] = useState(null);
  const [sound, setSound] = useState(null); // TTS/루프 공용 사운드
  const [statusText, setStatusText] = useState("대기 중이에요.");

  const [location, setLocation] = useState(null);
  const [permissionResponse, requestPermission] = Audio.usePermissions();

  const [isReported, setIsReported] = useState("긴급 신고");

  const recordingRef = useRef(null);
  const soundRef = useRef(null);
  const isLoopingRef = useRef(false);
  const silenceIntervalRef = useRef(null);

  const [reportedTime, setReportedTime] = useState(Date.now());

  const { playRingtone, stopRingtone } = useRingtone();

  useEffect(() => {
    let intervalId;

    (async () => {
      // ✅ 권한 요청
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        alert("위치 권한이 필요합니다.");
        return;
      }

      // ✅ 최초 1회 위치
      const current = await Location.getCurrentPositionAsync({});
      setLocation(current.coords);

      // ✅ 5초마다 반복
      intervalId = setInterval(async () => {
        try {
          const pos = await Location.getCurrentPositionAsync({});
          setLocation(pos.coords);
          // console.log("5초마다 위치:", pos.coords);
        } catch (e) {
          console.log("위치 가져오기 오류:", e);
        }
      }, 5000);
    })();

    // ✅ 언마운트 시 정리
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  // 🔁 상태 ref 동기화
  useEffect(() => {
    isLoopingRef.current = isLooping;
  }, [isLooping]);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);

  // 🔊 녹음 옵션 (metering 활성화)
  const recordingOptions = {
    isMeteringEnabled: true,
    android: {
      extension: ".m4a",
      outputFormat: Audio.RECORDING_OPTION_ANDROID_OUTPUT_FORMAT_MPEG_4,
      audioEncoder: Audio.RECORDING_OPTION_ANDROID_AUDIO_ENCODER_AAC,
      sampleRate: 44100,
      numberOfChannels: 1,
      bitRate: 128000,
    },
    ios: {
      extension: ".m4a",
      outputFormat: Audio.RECORDING_OPTION_IOS_OUTPUT_FORMAT_MPEG4AAC,
      audioQuality: Audio.RECORDING_OPTION_IOS_AUDIO_QUALITY_HIGH,
      sampleRate: 44100,
      numberOfChannels: 1,
      bitRate: 128000,
      linearPCMIsBigEndian: false,
      linearPCMIsFloat: false,
    },
    web: {
      mimeType: "audio/webm",
      bitsPerSecond: 128000,
    },
  };

  // ========== 공통: 현재 TTS/사운드 중단 함수 ==========
  const stopAITTS = async () => {
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      } catch (e) {
        console.warn("TTS 중단 오류:", e);
      }
      soundRef.current = null;
    }
  };

  // ========== 1. 가짜 전화 / AI 관련 로직 ==========

  // 통화 상태 전체 리셋 (+ 루프 & TTS 종료)
  const resetCall = async () => {
    setMode(null);
    setIsRinging(false);
    setInCall(false);
    setUserText("");
    setAiText("");
    setLoading(false);
    stopRingtone();
    setIsReported("긴급 신고");
    await stopLoop(); // 루프 종료
    await stopAITTS(); // TTS도 종료
  };

  // 모드 선택 → 전화 울리기 시작
  const startFakeCall = async (selectedModeIndex) => {
    setMode(selectedModeIndex);
    setAiText("");
    setUserText("");
    setInCall(false);
    setIsRinging(true);
    playRingtone();
    setIsReported("긴급 신고");
    await stopAITTS(); // TTS도 종료
  };

  // 전화 받기 + 루프 자동 시작
  const answerCall = async () => {
    setIsRinging(false);
    setInCall(true);
    startLoop();
    stopRingtone();
    setIsReported("긴급 신고");
  };

  // OpenAI TTS로 텍스트 읽기
  const speakWithOpenAITTS = async (text, voice, instructions) => {
    // 새로 말하기 전에 기존 TTS 정지
    await stopAITTS();

    try {
      // 1) OpenAI TTS 요청 (ArrayBuffer로 받기)
      const response = await axios.post(
        "https://api.openai.com/v1/audio/speech",
        {
          model: "gpt-4o-mini-tts",
          voice, // 예: "onyx", "coral", ...
          input: text, // 실제 말할 텍스트
          format: "mp3",
          instructions, // 페르소나/말투 설명
        },
        {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          responseType: "arraybuffer", // 🔥 ArrayBuffer
        }
      );

      // 2) ArrayBuffer → Uint8Array
      const bytes = new Uint8Array(response.data);

      // 3) 캐시에 파일 객체 만들기
      const fileName = `tts_${Date.now()}.mp3`;
      const file = new File(Paths.cache, fileName);

      // (create()는 없어도 write 할 때 자동 생성됨, 굳이 안 써도 됨)
      // await file.create();

      // 4) 파일에 쓰기 — 인자 1개만!
      await file.write(bytes);

      // 5) expo-av로 재생
      const { sound } = await Audio.Sound.createAsync(
        { uri: file.uri },
        { shouldPlay: true }
      );

      await sound.setRateAsync(1.25, true);

      soundRef.current = sound;

      sound.setOnPlaybackStatusUpdate(async (status) => {
        if (!status.isLoaded) return;

        if (status.didJustFinish) {
          try {
            await sound.unloadAsync();
          } catch (e) {
            console.warn("TTS 언로드 오류:", e);
          }

          if (soundRef.current === sound) {
            soundRef.current = null;
          }

          try {
            await file.delete(); // ✅ 재생 끝나면 파일 삭제
          } catch (e) {
            console.warn("TTS 파일 삭제 실패:", e);
          }
        }
      });
    } catch (e) {
      console.error("OpenAI TTS 오류:", e);
    }
  };

  // OpenAI에게 보내서 AI 대사 받고, TTS로 읽기
  const handleSendToAI = async (txt) => {
    if (!txt.trim()) return;
    setLoading(true);

    try {
      const personaPrompt = MODES[mode][1];

      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: personaPrompt,
            },
            {
              role: "user",
              content:
                "너는 위험한 길거리에서 상대방과 계속 전화해주는 역할을 수행해야 해. 상대방(사용자)은 지금 위험하거나 난처한 상황에서 전화를 받은 척 연기하고 있어. 실제 통화처럼 자연스럽게 한국어로 대답해줘.",
            },
            {
              role: "user",
              content: txt,
            },
          ],
          temperature: 0.8,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
        }
      );

      const content = response.data.choices[0].message.content.trim();
      setAiText(content);

      // OpenAI TTS로 말하기
      await speakWithOpenAITTS(content, MODES[mode][2], MODES[mode][1]);
    } catch (err) {
      console.error(err);
      const msg = "오류가 발생했어. 나중에 다시 시도해줘.";
      setAiText(msg);
      // 에러 메시지는 굳이 TTS 안 해도 될 것 같아서 텍스트만 표시
    } finally {
      setLoading(false);
    }
  };

  const checkText = (text) => {
    const regex =
      /[시씨씪슈쓔쉬쉽쒸쓉](?:[0-9]*|[0-9]+ *)[바발벌빠빡빨뻘파팔펄]|[섊좆좇졷좄좃좉졽썅춍봊]|[ㅈ조][0-9]*까|ㅅㅣㅂㅏㄹ?|ㅂ[0-9]*ㅅ|[ㅄᄲᇪᄺᄡᄣᄦᇠ]|[ㅅㅆᄴ][0-9]*[ㄲㅅㅆᄴㅂ]|[존좉좇][0-9 ]*나|[자보][0-9]+지|보빨|[봊봋봇봈볻봁봍] *[빨이]|[후훚훐훛훋훗훘훟훝훑][장앙]|[엠앰]창|애[미비]|애자|[가-탏탑-힣]색기|(?:[샊샛세쉐쉑쉨쉒객갞갟갯갰갴겍겎겏겤곅곆곇곗곘곜걕걖걗걧걨걬] *[끼키퀴])|새 *[키퀴]|[병븅][0-9]*[신딱딲]|미친[가-닣닥-힣]|[믿밑]힌|[염옘][0-9]*병|[샊샛샜샠섹섺셋셌셐셱솃솄솈섁섂섓섔섘]기|[섹섺섻쎅쎆쎇쎽쎾쎿섁섂섃썍썎썏][스쓰]|[지야][0-9]*랄|니[애에]미|갈[0-9]*보[^가-힣]|[뻐뻑뻒뻙뻨][0-9]*[뀨큐킹낑)|꼬[0-9]*추|곧[0-9]*휴|[가-힣]슬아치|자[0-9]*박꼼|빨통|[사싸](?:이코|가지|[0-9]*까시)|육[0-9]*시[랄럴]|육[0-9]*실[알얼할헐]|즐[^가-힣]|찌[0-9]*(?:질이|랭이)|찐[0-9]*따|찐[0-9]*찌버거|창[녀놈]|[가-힣]{2,}충[^가-힣]|[가-힣]{2,}츙|부녀자|화냥년|환[양향]년|호[0-9]*[구모]|죽이다|죽여버리다|강간|조[선센][징]|조센|[쪼쪽쪾](?:[발빨]이|[바빠]리)|盧|무현|찌끄[레래]기|(?:하악){2,}|하[앍앜]|[낭당랑앙항남담람암함][ ]?[가-힣]+[띠찌]|느[금급]마|文在|在寅|(?<=[^\n])[家哥]|속냐|[tT]l[qQ]kf|Wls|[ㅂ]신|[ㅅ]발|[ㅈ]밥|새끼|신고|도와*|살려*/;

    if (text.match(regex)) {
      console.log("❌ 신고");
      setIsReported("신고 대기");
      setReportedTime(Date.now());
    } else {
      console.log("✅ 정상");
    }
  };

  // 음성 → 텍스트 변환 (STT)
  const transcribeAudio = async (uri, setUserText) => {
    try {
      const formData = new FormData();
      formData.append("file", {
        uri,
        name: "audio.m4a",
        type: "audio/m4a",
      });
      formData.append("model", "gpt-4o-mini-transcribe");
      formData.append("language", "ko");

      const res = await axios.post(
        "https://api.openai.com/v1/audio/transcriptions",
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
        }
      );

      const text = res.data.text?.trim?.() || "";
      if (!text) return;

      setUserText(text.trim());

      checkText(text.trim());

      // 인식된 텍스트 바로 AI에게 넘겨서 답변/통화 이어가기
      await handleSendToAI(text.trim());
    } catch (e) {
      console.error("STT 변환 오류:", e);
    }
  };

  // ========== 2. 녹음/재생 루프 로직 ==========

  // 🎙️ 새로운 한 덩어리 녹음 시작
  const startChunkRecording = async () => {
    try {
      if (!permissionResponse || permissionResponse.status !== "granted") {
        const res = await requestPermission();
        if (!res || res.status !== "granted") {
          alert("서비스 이용을 위해 마이크 접근 권한이 필요해요.");
          return;
        }
      }

      setStatusText("음성 수신 준비 중...");
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(recordingOptions);
      await rec.startAsync();
      setRecording(rec);
      setStatusText("음성 수신을 시작했어요. 말씀해 보세요!");

      startSilenceWatcher(rec);
    } catch (e) {
      console.error("녹음 시작 실패:", e);
      setStatusText("음성 수신에 실패했어요.");
    }
  };

  // 🤫 상대적 데시벨 기준으로 "말이 끝났는지" 감시
  const startSilenceWatcher = (rec) => {
    const windowSize = 12;
    const INTERVAL = 200;
    const MIN_SILENCE_MS = 1000;

    let recentLevels = [];
    let silentFor = 0;

    clearInterval(silenceIntervalRef.current);
    silenceIntervalRef.current = setInterval(async () => {
      try {
        const status = await rec.getStatusAsync();
        if (!status || !status.canRecord) return;

        const level = status.metering;

        if (level == null) {
          silentFor += INTERVAL;
          if (silentFor >= 3000) {
            clearInterval(silenceIntervalRef.current);
            await stopCurrentRecordingAndPlay(rec);
          }
          return;
        }

        recentLevels.push(level);
        if (recentLevels.length > windowSize) recentLevels.shift();

        const avg =
          recentLevels.reduce((a, b) => a + b, 0) / recentLevels.length;

        const threshold = avg * 0.7;

        if (level < threshold && avg >= -27.5) {
          silentFor += INTERVAL;
          setStatusText(
            `말씀하신 내용을 정리 중이에요... ${(silentFor / 1000).toFixed(
              1
            )}s\n(avg ${avg.toFixed(1)} dB, now ${level.toFixed(1)} dB)`
          );
        } else {
          silentFor = 0;
          setStatusText(
            `듣고 있어요!\n(avg ${avg.toFixed(1)} dB, now ${level.toFixed(
              1
            )} dB)`
          );
        }

        if (silentFor >= MIN_SILENCE_MS) {
          clearInterval(silenceIntervalRef.current);
          await stopCurrentRecordingAndPlay(rec);
        }
      } catch (e) {
        console.error("silence watcher error:", e);
      }
    }, INTERVAL);
  };

  // ⏹ 현재 녹음 종료 + STT + 다음 녹음 준비
  const stopCurrentRecordingAndPlay = async (rec) => {
    try {
      setStatusText("음성 수신 마무리 중...");
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      setRecording(null);

      if (!uri) {
        setStatusText("음성 수신 실패");
        if (isLoopingRef.current) {
          await startChunkRecording();
        }
        return;
      }

      setUserText("음성 인식 중...");
      await transcribeAudio(uri, setUserText);

      // 재생은 AI의 TTS로 처리되고 있으므로
      // 여기서는 바로 다음 chunk 녹음만 준비
      if (isLoopingRef.current) {
        startChunkRecording();
      } else {
        setStatusText("대기 중이에요.");
      }
    } catch (e) {
      console.error("녹음 종료/재생 오류:", e);
      setStatusText("음성 수신/재생에서 오류가 발생했어요.");
      if (isLoopingRef.current) {
        await startChunkRecording();
      }
    }
  };

  // ▶ 루프 시작
  const startLoop = async () => {
    if (isLoopingRef.current) return;
    setIsLooping(true);
    setStatusText("시작 준비 중이에요...");
    await startChunkRecording();
  };

  // ⏹ 루프 완전 종료
  const stopLoop = async () => {
    setIsLooping(false);
    clearInterval(silenceIntervalRef.current);

    try {
      if (recordingRef.current) {
        const r = recordingRef.current;
        recordingRef.current = null;
        await r.stopAndUnloadAsync();
      }
    } catch (e) {
      // 이미 정지된 상태일 수 있음
    }

    await stopAITTS();

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
    });

    setStatusText("대기 중이에요.");
  };

  const report = async () => {
    if (isReported !== "신고 대기") return;
    console.log("보고");
    setIsReported("신고 완료");
    try {
      const response = await axios.post(
        "http://172.31.58.175:4000/send-mail",
        {
          pos: {
            longitude: location.longitude,
            latitude: location.latitude,
          },
        },
        {}
      );
    } catch (e) {
      console.log(e.message);
    }
  };

  // ========== 3. 화면 렌더링 ==========

  // ▶ 홈 화면 (모드 선택)
  if (!mode && !isRinging && !inCall) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Guardian Call</Text>
        <Text style={styles.subtitle}>누구와 통화하며 안전해질까요?</Text>

        {MODES.map((o, i) => (
          <TouchableOpacity
            style={styles.modeBtn}
            onPress={() => startFakeCall(i)}
            key={o[0]}
          >
            <Text style={styles.modeText}>{o[0]}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  // ▶ 가짜 전화 수신 화면
  if (isRinging) {
    return (
      <View style={styles.container}>
        <Text style={styles.ringingText}>
          {MODES[mode][0]}에게서 전화가 걸려왔어요!
        </Text>
        <View style={styles.row}>
          <Button
            labelStyle={{ color: "white" }}
            buttonColor="red"
            onPress={resetCall}
          >
            거절
          </Button>
          <Button
            title="응답"
            labelStyle={{ color: "white" }}
            buttonColor="#37b24d"
            onPress={answerCall}
          >
            응답
          </Button>
        </View>
      </View>
    );
  }

  if (isReported === "신고 대기" && Date.now() - reportedTime >= 3000) {
    report();
  }

  // ▶ 통화 화면
  if (inCall) {
    return (
      <View style={styles.callContainer}>
        <Text style={styles.callTitle}>{MODES[mode][0]}와 통화 중</Text>

        <Text style={styles.sectionTitle}>나</Text>
        <TextInput
          style={styles.input}
          placeholder="말하면 자동으로 텍스트가 채워져요"
          placeholderTextColor="#555"
          value={userText}
          onChangeText={setUserText}
        />

        {aiText ? (
          <>
            <Text style={styles.sectionTitle}>{MODES[mode][0]}</Text>
            <Text style={styles.aiText}>{aiText}</Text>
          </>
        ) : null}

        <View style={styles.loopBox}>
          <Text style={styles.sectionTitle}>통화 상태</Text>
          <Text style={styles.loopStatus}>{statusText}</Text>

          <Text style={styles.loopInfo}>말씀하시다 멈추시면 AI가 대답해요</Text>
        </View>

        <View style={{ marginTop: 20 }}>
          <Button
            labelStyle={{ color: "black" }}
            buttonColor="#f59f00"
            onPress={resetCall}
            style={{ borderRadius: 8 }}
          >
            통화 종료
          </Button>
        </View>

        <View style={{ marginTop: "auto", marginBottom: 20 }}>
          <Button
            labelStyle={{
              color: isReported == "신고 완료" ? "red" : "white",
              fontSize: 18,
              fontWeight: "bold",
            }}
            buttonColor={
              isReported == "신고 완료"
                ? "white"
                : isReported === "긴급 신고"
                ? "red"
                : "#f59f00"
            }
            onPress={
              isReported === "신고 완료"
                ? () => {}
                : isReported === "신고 대기"
                ? () => {
                    setIsReported("긴급 신고");
                  }
                : () => {
                    setIsReported("신고 대기");
                    setReportedTime(Date.now());
                  }
            }
            contentStyle={{ paddingVertical: 8 }}
            style={{ borderRadius: 8 }}
          >
            {isReported == "신고 대기"
              ? `신고 대기(${
                  Math.floor((reportedTime + 3000 - Date.now()) / 100) / 10
                } 초)`
              : isReported}
          </Button>
        </View>
      </View>
    );
  }

  return null;
}

// ========== 스타일 ==========
const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000",
  },
  callContainer: {
    flex: 1,
    padding: 24,
    backgroundColor: "#000",
  },
  title: {
    fontSize: 32,
    color: "#fff",
    marginBottom: 16,
    fontWeight: "bold",
  },
  subtitle: {
    fontSize: 16,
    color: "#ccc",
    marginBottom: 24,
  },
  modeBtn: {
    width: "100%",
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: "#1e1e1e",
  },
  modeText: {
    color: "#fff",
    fontSize: 16,
    textAlign: "center",
  },
  ringingText: {
    color: "#fff",
    fontSize: 20,
    marginBottom: 24,
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
  },
  callTitle: {
    color: "#fff",
    fontSize: 24,
    marginBottom: 16,
    textAlign: "center",
  },
  sectionTitle: {
    color: "#aaa",
    fontSize: 14,
    marginTop: 16,
    marginBottom: 4,
  },
  input: {
    backgroundColor: "#111",
    color: "#fff",
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  aiText: {
    color: "#fff",
    marginTop: 8,
    fontSize: 15,
  },
  loopBox: {
    marginTop: 24,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#111",
  },
  loopStatus: {
    color: "#0fdf8f",
    fontSize: 12,
    marginBottom: 8,
  },
  loopButton: {
    marginTop: 4,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#2ecc71",
    alignItems: "center",
  },
  loopButtonStop: {
    backgroundColor: "#e74c3c",
  },
  loopButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  loopInfo: {
    marginTop: 6,
    fontSize: 11,
    color: "#888",
  },
});
