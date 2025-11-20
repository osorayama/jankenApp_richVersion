import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";
// - 最初の3秒で neutralOpen を平均取得し、mouthOpen > neutralOpen * しきい値 で笑った扱い

$(function () { 
  const $video = $("#video");
  const $userState = $("#userState");
  const $cpuState = $("#cpuState");
  const $cpuFaceEmoji = $("#cpuFaceEmoji");
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
  let running = false;
  let collectingNeutral = false;
  let neutralSum = 0; // neutral の合計値
  let neutralCount = 0; // neutral サンプル数
  let neutralOpen = null; // neutral 平均
  let userSmiled = false;
  let cpuSmiled = false;
  let resultDecided = false;
  let cpuTimerId = null;

  // MediaPipe
  let faceLandmarker = null;
  let smileFactor = 1.5; // しきい値（固定値：大きいほど笑いにくい）

  function applyDifficultyFromSlider() {
    // slider value: 1=easy, 2=normal, 3=hard
    const v = ($difficulty && $difficulty.length) ? parseInt($difficulty.val(), 10) : 2;
    if (v === 1) {
      smileFactor = 20;
      $difficultyLabel && $difficultyLabel.text('難易度: 簡単');
    } else if (v === 2) {
      smileFactor = 10;
      $difficultyLabel && $difficultyLabel.text('難易度: 普通');
    } else if (v === 3) {
      smileFactor = 1;
      $difficultyLabel && $difficultyLabel.text('難易度: 難しい');
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

  function updateCpuState(smiled) {
    $cpuState.text(smiled ? "😂 笑った！！" : "😐 真顔キープ中");
    if ($cpuFaceEmoji.length) {
      $cpuFaceEmoji.text(smiled ? "😂" : "😐");
    }
  }

  function setResult(text) {
    $result.text(text);
    if (text === "-" || text === "") {
      $result.removeClass("opacity-100 text-rose-600 border-rose-300 text-sky-600 border-sky-300").addClass("opacity-0");
    } else {
      $result.removeClass("opacity-0").addClass("opacity-100");
    }
  }

  function resetUI() {
    updateUserState("スタートボタンを押して対戦開始");
    updateCpuState(false);
    setResult("-");
  }

  async function setupCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
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
      resultDecided = true;
      setResult("YOU LOSE");
      $result.removeClass("text-rose-600 border-rose-300");
      $result.addClass("text-sky-600 border-sky-300");
      stopCpuTimer();
      running = false;
    } else if (cpuSmiled && !userSmiled) {
      resultDecided = true;
      setResult("YOU WIN");
      $result.removeClass("text-sky-600 border-sky-300");
      $result.addClass("text-rose-600 border-rose-300");
      running = false;
    }
  }

  function startCpuTimer() {
    stopCpuTimer();
    const laughTime = Math.random() * 5000 + 2000;
    cpuTimerId = setTimeout(() => {
      if (!resultDecided) {
        cpuSmiled = true;
        updateCpuState(true);
        finalizeResult();
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
    try {
      const stream = videoEl.srcObject;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      videoEl.srcObject = null;
    } catch (_) {}
  }

  function initState() {
    running = false;
    collectingNeutral = false;
    neutralSum = 0;
    neutralCount = 0;
    neutralOpen = null;
    userSmiled = false;
    cpuSmiled = false;
    resultDecided = false;
  }

  async function startGame() {
    initState();
    resetUI();
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
  }

  $startBtn.on("click", () => {
    if (running) return;
    startGame().catch(() => {
      running = false;
    });
  });

  $resetBtn.on("click", resetGame);
  if ($difficulty && $difficulty.length) {
    $difficulty.on('input change', applyDifficultyFromSlider);
    // initialize label
    applyDifficultyFromSlider();
  }

  resetUI();
});

