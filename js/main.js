import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";
import { cpuFaces, cpuJokes } from "./cpuFaces.js";
// - 最初の3秒で neutralOpen を平均取得し、mouthOpen > neutralOpen * しきい値 で笑った扱い

$(function () { 
  const $video = $("#video");
  const $userState = $("#userState");
  const $cpuState = $("#cpuState");
  const $cpuFaceEmoji = $("#cpuFaceEmoji");
  const $cpuFaceLabel = $("#cpuFaceLabel");
  const $result = $("#result");
  const $difficulty = $("#difficulty");
  const $difficultyLabel = $("#difficultyLabel");
  const $startBtn = $("#startBtn");
  const $resetBtn = $("#resetBtn");

  const videoEl = $video.get(0);
  if (!videoEl) {
    console.error("video 要素が見つかりません。");
    return;
  }

  // 状態
  let running, collectingNeutral, neutralSum, neutralCount, neutralOpen, userSmiled, cpuSmiled, resultDecided, cpuTimerId;
  let faceLandmarker, smileFactor = 1.5;

  function applyDifficultyFromSlider() {
    const v = Number($difficulty?.val() || 2);
    const levels = [null, {f:20, t:'簡単'}, {f:10, t:'普通'}, {f:1, t:'難しい'}];
    if (levels[v]) {
      smileFactor = levels[v].f;
      $difficultyLabel?.text(`難易度: ${levels[v].t}`);
    }
  }

  // ユーティリティ
  function distance(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.hypot(dx, dy);
  }

  function updateUserState(text) {
    $userState.text(text);
  }

  // CPU表情状態
  // neutral, smile, win, lose, wink, surprise, tongue, silly, squint, cool
  function updateCpuState(state, jokeText = null) {
    const faces = {
      neutral: {face: cpuFaces.neutral, label: "真顔", text: "😐 真顔キープ中"},
      smile: {face: cpuFaces.smile, label: "笑顔", text: "😂 笑った！！"},
      win: {face: cpuFaces.win, label: "ドヤ顔", text: "😎 YOUが笑ったのでCPUの勝ち！"},
      lose: {face: cpuFaces.lose, label: "泣き顔", text: "😭 CPUが笑って負け…"},
      wink: {face: cpuFaces.wink, label: "ウインク", text: "😉 ウインク！"},
      surprise: {face: cpuFaces.surprise, label: "びっくり", text: "😯 びっくり！"},
      tongue: {face: cpuFaces.tongue, label: "舌出し", text: "😛 べーっ！"},
      silly: {face: cpuFaces.silly, label: "変な顔", text: "🤪 変顔！"},
      squint: {face: cpuFaces.squint, label: "ウインク舌出し", text: "😜 ウインク＆べー！"}
    };
    const {face, label, text} = faces[state] || faces.neutral;
    $("#cpuJoke").text(jokeText || "");
    $cpuFaceEmoji.html(face).addClass('pop-anim');
    setTimeout(() => $cpuFaceEmoji.removeClass('pop-anim'), 350);
    $cpuFaceLabel.text(label);
    $cpuState.text(text);
  }

  function setResult(text) {
    $result.text(text);
    $result.toggleClass("opacity-0", text === "-" || text === "");
    $result.toggleClass("opacity-100", text !== "-" && text !== "");
  }

  function resetUI() {
    updateUserState("スタートボタンを押して対戦開始");
    updateCpuState("neutral");
    setResult("-");
    $startBtn.prop('disabled', false); // スタートボタン有効化
    $resetBtn.prop('disabled', true);  // もう一度ボタンは無効化
  }

  async function setupCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      videoEl.srcObject = stream;
      await videoEl.play();
    } catch (e) {
      setResult("カメラへのアクセスに失敗しました（権限を確認）");
      throw e;
    }
  }

  async function setupFaceLandmarker() {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );

    const LOCAL_MODEL = "models/face_landmarker.task";
    const REMOTE_MODEL =
      "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";

    try {
      faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: LOCAL_MODEL },
        runningMode: "VIDEO",
        numFaces: 1,
      });
      return;
    } catch (e1) {
      console.warn("ローカルモデル読み込み失敗。オンラインモデルを試します…", e1);
      setResult("ローカルモデルなし → オンラインから取得中…");
      try {
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: REMOTE_MODEL },
          runningMode: "VIDEO",
          numFaces: 1,
        });
        setResult("-");
        return;
      } catch (e2) {
        console.error(e2);
        setResult(
          "モデル読み込みに失敗：models/face_landmarker.task を配置するか、ネットワーク接続を確認してください"
        );
        throw e2;
      }
    }
  }

  // 勝敗を確定して表示する
  function finalizeResult() {
    if (resultDecided) return;
    if (userSmiled && !cpuSmiled) {
      // ユーザーが笑って負け → CPUはドヤ顔
      resultDecided = true;
      setResult("YOU LOSE");
      $result.removeClass("text-rose-600 border-rose-300");
      $result.addClass("text-sky-600 border-sky-300");
      updateCpuState("win");
      stopCpuTimer();
      running = false;
      $resetBtn.prop('disabled', false); // もう一度ボタン有効化
    } else if (cpuSmiled && !userSmiled) {
      // CPUが笑って負け → CPUは泣き顔
      resultDecided = true;
      setResult("YOU WIN");
      $result.removeClass("text-sky-600 border-sky-300");
      $result.addClass("text-rose-600 border-rose-300");
      updateCpuState("lose");
      running = false;
      $resetBtn.prop('disabled', false); // もう一度ボタン有効化
    }
  }

  function startCpuTimer() {
    stopCpuTimer();
    // 3秒ごとに必ずランダムな顔と駄洒落を同時に表示
    const faceKeys = ["neutral", "wink", "tongue", "silly", "squint", "surprise"];
    function showFaceAndJoke() {
      if (resultDecided) return;
      const faceKey = faceKeys[Math.floor(Math.random() * faceKeys.length)];
      const joke = cpuJokes[Math.floor(Math.random() * cpuJokes.length)];
      updateCpuState(faceKey, joke);
      cpuTimerId = setTimeout(showFaceAndJoke, 3000);
    }
    showFaceAndJoke();
    const laughTime = Math.random() * 7000 + 6000; // 6〜13秒で笑う
    cpuTimerId = setTimeout(() => {
      if (!resultDecided) {
        cpuSmiled = true;
        updateCpuState("smile");
        // 0.8秒ほどsmileを見せてから勝敗確定
        setTimeout(() => {
          if (!resultDecided) finalizeResult();
        }, 800);
      }
    }, laughTime);
  }

  function stopCpuTimer() {
    if (cpuTimerId) {
      clearTimeout(cpuTimerId);
      cpuTimerId = null;
    }
  }

  function stopCamera() {
    const stream = videoEl.srcObject;
    stream?.getTracks().forEach(t => t.stop());
    videoEl.srcObject = null;
  }

  function initState() {
    running = collectingNeutral = userSmiled = cpuSmiled = resultDecided = false;
    neutralSum = neutralCount = 0;
    neutralOpen = null;
  }

  async function startGame() {
    initState();
    resetUI();
    $startBtn.prop('disabled', true); // スタートボタンを無効化
    $resetBtn.prop('disabled', true); // もう一度ボタンも無効化
    applyDifficultyFromSlider();
    await setupCamera();
    await setupFaceLandmarker();
    collectingNeutral = true;
    neutralEndTs = performance.now() + 3000;
    running = true;
    requestAnimationFrame(loop);
  }

  let neutralEndTs = 0; // 収集終了時刻

  function loop() {
    if (!running) return;
    const ts = performance.now();
    if (faceLandmarker) {
      const detection = faceLandmarker.detectForVideo(videoEl, ts);
      const lm = detection?.faceLandmarks?.[0];
      const upper = lm?.[13];
      const lower = lm?.[14];
      if (upper && lower) {
        const mouthOpen = distance(upper, lower);
        if (collectingNeutral) {
          neutralSum += mouthOpen;
          neutralCount++;
          updateUserState("😐 真顔キープ中（計測中...）");
          if (ts >= neutralEndTs) {
            collectingNeutral = false;
            neutralOpen = neutralCount ? neutralSum / neutralCount : mouthOpen;
            updateUserState("😐 にらめっこ開始！真顔キープ中");
            if (!cpuTimerId) startCpuTimer();
          }
        } else if (!userSmiled && neutralOpen != null && mouthOpen > neutralOpen * smileFactor) {
          userSmiled = true;
          updateUserState("😂 笑った！");
          finalizeResult();
        }
      }
    }
    requestAnimationFrame(loop);
  }

  function resetGame() {
    running = false;
    stopCpuTimer();
    stopCamera();
    resetUI();
    $startBtn.prop('disabled', false); // スタートボタン有効化
    $resetBtn.prop('disabled', true);  // もう一度ボタンは無効化
  }

  $startBtn.on("click", () => {
    if (running || $startBtn.prop('disabled')) return;
    startGame().catch(() => {
      running = false;
      $startBtn.prop('disabled', false);
    });
  });

  $resetBtn.on("click", () => {
    if ($resetBtn.prop('disabled')) return;
    resetGame();
  });
});

