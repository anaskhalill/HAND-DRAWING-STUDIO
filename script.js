(() => {
    "use strict";

    const $ = id => document.getElementById(id);

    const video = $("video");
    const canvas = $("canvas");
    const ctx = canvas.getContext("2d");

    const statusEl = $("status");
    const statusPill = $("statusPill");
    const fpsEl = $("fps");
    const cursorEl = $("cursor");
    const shadeEl = $("stageShade");
    const shadeTitle = $("shadeTitle");
    const shadeText = $("shadeText");
    const shadeIcon = shadeEl.querySelector(".stage-shade__icon");
    const swatches = $("swatches");
    const brushInput = $("brushSize");
    const brushValue = $("brushValue");
    const undoBtn = $("undoBtn");
    const clearBtn = $("clearBtn");
    const saveBtn = $("saveBtn");
    const hudGesture = $("hudGesture");
    const hudBrush = $("hudBrush");
    const readoutGesture = $("readoutGesture");
    const readoutColorName = $("readoutColorName");
    const readoutColorDot = $("readoutColor").querySelector("i");
    const readoutBrush = $("readoutBrush");
    const actionLog = $("actionLog");

    const PALETTE = {
        purple: "#b96bff",
        cyan: "#38e8ff",
        coral: "#ff5f7e",
        pink: "#ff7ad9",
        lime: "#9dff6b",
        gold: "#ffd166"
    };

    const GESTURES = {
        fist:  { short: "FIST",        label: "Purple", color: "purple" },
        peace: { short: "PEACE",       label: "Cyan",   color: "cyan" },
        thumb: { short: "THUMBS UP",   label: "Coral",  color: "coral" },
        three: { short: "THREE",       label: "Pink",   color: "pink" },
        four:  { short: "FOUR",        label: "Lime",   color: "lime" },
        call:  { short: "THUMB + PINKY", label: "Gold", color: "gold" },
        open:  { short: "OPEN HAND",   label: "Clear",  action: "clear" },
        undo:  { short: "PINKY",       label: "Undo",   action: "undo" },
        save:  { short: "RING + PINKY", label: "Save PNG", action: "save" }
    };

    const PINCH_ON = 0.32;
    const PINCH_OFF = 0.5;
    const GESTURE_HOLD = 6;
    const EXTEND_ANGLE = 150;

    let color = "purple";
    let brushSize = Number(brushInput.value) || 8;

    let strokes = [];
    let activeStroke = null;
    let lastPoint = null;

    let pinching = false;
    let candidate = null;
    let candidateFrames = 0;
    let stableGesture = null;
    let sending = false;

    let frames = 0;
    let fpsClock = performance.now();
    let statusLockUntil = 0;

    /* ---------- UI helpers ---------- */

    function setText(element, text) {
        if (element.textContent !== text) element.textContent = text;
    }

    function setStatus(text, state, holdMs = 0) {
        setText(statusEl, text);
        if (statusPill.dataset.state !== state) statusPill.dataset.state = state;
        if (holdMs) statusLockUntil = performance.now() + holdMs;
    }

    function routineStatus(text, state) {
        if (performance.now() < statusLockUntil) return;
        setStatus(text, state);
    }

    function showShade(title, text, icon = "◈") {
        setText(shadeTitle, title);
        setText(shadeText, text);
        setText(shadeIcon, icon);
        shadeEl.classList.remove("is-hidden");
    }

    function hideShade() {
        shadeEl.classList.add("is-hidden");
    }

    function logAction(text) {
        const item = document.createElement("div");
        item.className = "action-log__item";
        item.textContent = text;
        actionLog.prepend(item);
        while (actionLog.children.length > 3) actionLog.lastChild.remove();
    }

    function setColor(name) {
        if (!PALETTE[name]) return;
        color = name;
        const label = name.charAt(0).toUpperCase() + name.slice(1);

        cursorEl.style.setProperty("--cursor-color", PALETTE[name]);
        setText(readoutColorName, label);
        readoutColorDot.style.background = PALETTE[name];
        readoutColorDot.style.color = PALETTE[name];

        swatches.querySelectorAll(".swatch").forEach(button => {
            const active = button.dataset.color === name;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", String(active));
        });
    }

    function setBrushSize(size, fromHand = false) {
        brushSize = Math.max(2, Math.min(24, Math.round(size)));
        brushValue.value = String(brushSize);
        if (fromHand) brushInput.value = String(brushSize);
        setText(readoutBrush, `${brushSize} PX`);
        setText(hudBrush, `${brushSize} PX`);
    }

    function updateCursor(point, visible) {
        if (!visible || !point) {
            cursorEl.classList.remove("is-visible", "is-drawing");
            return;
        }
        cursorEl.style.left = `${point.x / canvas.width * 100}%`;
        cursorEl.style.top = `${point.y / canvas.height * 100}%`;
        cursorEl.classList.add("is-visible");
        cursorEl.classList.toggle("is-drawing", pinching);
    }

    function updateFps() {
        frames++;
        const now = performance.now();
        if (now - fpsClock >= 600) {
            setText(fpsEl, `${Math.round(frames * 1000 / (now - fpsClock))} FPS`);
            frames = 0;
            fpsClock = now;
        }
    }

    /* ---------- Drawing ---------- */

    function distance(a, b) {
        return Math.hypot(a.x - b.x, a.y - b.y);
    }

    function drawSegment(from, to, strokeColor, size) {
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = size;
        ctx.shadowColor = strokeColor;
        ctx.shadowBlur = size * 2.2;
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.38)";
        ctx.lineWidth = Math.max(1, size * 0.2);
        ctx.stroke();
        ctx.restore();
    }

    function redrawAll() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        strokes.forEach(stroke => {
            for (let i = 1; i < stroke.points.length; i++) {
                drawSegment(stroke.points[i - 1], stroke.points[i], stroke.color, stroke.size);
            }
        });
    }

    function addPoint(point) {
        if (!activeStroke) {
            activeStroke = { color: PALETTE[color], size: brushSize, points: [] };
            strokes.push(activeStroke);
        }
        activeStroke.size = brushSize;
        activeStroke.points.push(point);
        if (lastPoint) drawSegment(lastPoint, point, activeStroke.color, activeStroke.size);
        lastPoint = point;
    }

    function endStroke() {
        activeStroke = null;
        lastPoint = null;
    }

    function clearCanvas() {
        strokes = [];
        endStroke();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        setStatus("CANVAS CLEARED", "ready");
    }

    function undo() {
        if (!strokes.length) return false;
        strokes.pop();
        endStroke();
        redrawAll();
        setStatus("STROKE REMOVED", "ready");
        return true;
    }

    function saveImage() {
        const output = document.createElement("canvas");
        output.width = canvas.width;
        output.height = canvas.height;
        const outCtx = output.getContext("2d");
        const gradient = outCtx.createLinearGradient(0, 0, output.width, output.height);
        gradient.addColorStop(0, "#1a0d33");
        gradient.addColorStop(1, "#06040e");
        outCtx.fillStyle = gradient;
        outCtx.fillRect(0, 0, output.width, output.height);
        outCtx.drawImage(canvas, 0, 0);

        const link = document.createElement("a");
        link.download = `hand-drawing-${new Date().toISOString().slice(0, 10)}.png`;
        link.href = output.toDataURL("image/png");
        link.click();
        setStatus("PNG SAVED", "ready");
    }

    /* ---------- Mouse / touch fallback ---------- */

    function eventPoint(event) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left) / rect.width * canvas.width,
            y: (event.clientY - rect.top) / rect.height * canvas.height
        };
    }

    canvas.addEventListener("pointerdown", event => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        canvas.setPointerCapture(event.pointerId);
        endStroke();
        addPoint(eventPoint(event));
        setStatus("DRAWING · POINTER", "drawing");
    });

    canvas.addEventListener("pointermove", event => {
        if (!activeStroke || !canvas.hasPointerCapture(event.pointerId)) return;
        addPoint(eventPoint(event));
    });

    ["pointerup", "pointercancel", "lostpointercapture"].forEach(type => {
        canvas.addEventListener(type, () => {
            if (activeStroke) {
                endStroke();
                routineStatus("SHOW YOUR HAND TO BEGIN", "ready");
            }
        });
    });

    /* ---------- Geometry & gesture recognition ---------- */

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    // Mirrored canvas coordinates, including object-fit: cover cropping.
    function mapPoint(landmark) {
        const vw = video.videoWidth || 900;
        const vh = video.videoHeight || 600;
        const stageAspect = canvas.width / canvas.height;
        const videoAspect = vw / vh;

        let visibleX = 1;
        let visibleY = 1;
        let cropX = 0;
        let cropY = 0;

        if (videoAspect > stageAspect) {
            visibleX = stageAspect / videoAspect;
            cropX = (1 - visibleX) / 2;
        } else if (videoAspect < stageAspect) {
            visibleY = videoAspect / stageAspect;
            cropY = (1 - visibleY) / 2;
        }

        return {
            x: (1 - (landmark.x - cropX) / visibleX) * canvas.width,
            y: ((landmark.y - cropY) / visibleY) * canvas.height
        };
    }

    function angleAt(a, b, c) {
        const v1 = { x: a.x - b.x, y: a.y - b.y };
        const v2 = { x: c.x - b.x, y: c.y - b.y };
        const magnitude = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
        if (magnitude < 1e-6) return 0;
        const cosine = clamp((v1.x * v2.x + v1.y * v2.y) / magnitude, -1, 1);
        return Math.acos(cosine) * 180 / Math.PI;
    }

    // Angles are rotation-invariant, unlike simple "tip is above joint" checks.
    function extendedFingers(points) {
        const straight = (mcp, pip, tip) => angleAt(points[mcp], points[pip], points[tip]) > EXTEND_ANGLE;

        const index = straight(5, 6, 8);
        const middle = straight(9, 10, 12);
        const ring = straight(13, 14, 16);
        const pinky = straight(17, 18, 20);

        const thumbAngle = angleAt(points[2], points[3], points[4]);
        const thumbSpread = distance(points[4], points[17]) > distance(points[3], points[17]) * 1.02;
        const thumb = thumbAngle > EXTEND_ANGLE - 5 && thumbSpread;

        return { thumb, index, middle, ring, pinky };
    }

    function classifyFlags(flags) {
        const key = [flags.thumb, flags.index, flags.middle, flags.ring, flags.pinky]
            .map(Boolean).map(Number).join("");

        switch (key) {
            case "00000": return "fist";
            case "10000": return "thumb";
            case "01100": return "peace";
            case "01110": return "three";
            case "01111": return "four";
            case "10001": return "call";
            case "11111": return "open";
            case "00001": return "undo";
            case "00011": return "save";
            default: return null;
        }
    }

    function classifyGesture(points) {
        return classifyFlags(extendedFingers(points));
    }

    function brushFromPinch(pinchDistance, palmSize) {
        const ratio = clamp(pinchDistance / palmSize, 0.05, PINCH_ON);
        const pressure = (PINCH_ON - ratio) / (PINCH_ON - 0.05);
        return Math.round(2 + pressure * 22);
    }

    // A folded fist also brings thumb and index tips together. A real pinch
    // pushes the index tip out in front of its knuckle, which this checks.
    function isPinchPose(points) {
        const tipReach = distance(points[8], points[0]);
        const knuckleReach = distance(points[5], points[0]);
        return tipReach > knuckleReach * 1.35;
    }

    function applyGesture(gesture) {
        const info = GESTURES[gesture];
        if (!info) return;

        if (info.color) {
            setColor(info.color);
            setStatus(`COLOUR / ${info.label.toUpperCase()}`, "ready", 1100);
            logAction(`COLOUR / ${info.label.toUpperCase()}`);
        } else if (info.action === "clear") {
            clearCanvas();
            setStatus("CANVAS CLEARED", "ready", 1200);
            logAction("CANVAS / CLEARED");
        } else if (info.action === "undo") {
            const removed = undo();
            setStatus(removed ? "STROKE REMOVED" : "NOTHING TO UNDO", "ready", 1100);
            logAction(removed ? "STROKE / REMOVED" : "STROKE / NONE");
        } else if (info.action === "save") {
            saveImage();
            logAction("EXPORT / PNG SAVED");
        }
    }

    function updateGesture(gesture) {
        if (gesture === candidate) {
            candidateFrames++;
        } else {
            candidate = gesture;
            candidateFrames = 1;
        }

        if (gesture && candidateFrames >= GESTURE_HOLD && gesture !== stableGesture) {
            stableGesture = gesture;
            applyGesture(gesture);
        } else if (!gesture) {
            stableGesture = null;
        }
    }

    function onResults(results) {
        updateFps();
        const landmarks = results.multiHandLandmarks;

        if (!landmarks || !landmarks.length) {
            if (pinching) endStroke();
            pinching = false;
            candidate = null;
            candidateFrames = 0;
            stableGesture = null;
            updateCursor(null, false);
            setText(readoutGesture, "—");
            setText(hudGesture, "—");
            routineStatus("SHOW YOUR HAND TO BEGIN", "ready");
            return;
        }

        hideShade();
        const points = landmarks[0].map(mapPoint);
        const fingertip = points[8];
        updateCursor(fingertip, true);

        const palmSize = Math.max(25, distance(points[0], points[9]));
        const pinchDistance = distance(points[4], points[8]);

        if (pinching) {
            if (pinchDistance > palmSize * PINCH_OFF) {
                pinching = false;
                endStroke();
            }
        } else if (pinchDistance < palmSize * PINCH_ON && isPinchPose(points)) {
            pinching = true;
        }

        if (pinching) {
            candidate = null;
            candidateFrames = 0;
            stableGesture = null;

            setBrushSize(brushFromPinch(pinchDistance, palmSize), true);
            addPoint(fingertip);
            cursorEl.classList.add("is-drawing");

            setText(readoutGesture, "PINCH / DRAW");
            setText(hudGesture, "PINCH / DRAW");
            setStatus(`DRAWING · ${brushSize} PX`, "drawing");
        } else {
            cursorEl.classList.remove("is-drawing");
            const gesture = classifyGesture(points);
            updateGesture(gesture);

            const label = gesture && GESTURES[gesture] ? GESTURES[gesture].short : "—";
            setText(readoutGesture, label);
            setText(hudGesture, label);
            routineStatus("HAND TRACKED · MAKE A GESTURE", "ready");
        }
    }

    /* ---------- Setup ---------- */

    function fail(title, text) {
        showShade(title, text, "◈");
        setStatus(title, "error");
        setText(fpsEl, "-- FPS");
    }

    async function init() {
        if (typeof Hands === "undefined") {
            fail("TRACKING LIBRARY UNAVAILABLE", "CHECK YOUR CONNECTION AND RELOAD THE PAGE.");
            return;
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            fail("CAMERA UNAVAILABLE", "USE LOCALHOST OR HTTPS TO GRANT CAMERA ACCESS.");
            return;
        }

        try {
            const hands = new Hands({
                locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
            });

            hands.setOptions({
                maxNumHands: 1,
                modelComplexity: 1,
                minDetectionConfidence: 0.7,
                minTrackingConfidence: 0.7
            });

            hands.onResults(onResults);

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                    facingMode: "user",
                    width: { ideal: 900 },
                    height: { ideal: 600 }
                }
            });

            video.srcObject = stream;
            await video.play();

            const nextFrame = async () => {
                if (!sending && video.readyState >= 2) {
                    sending = true;
                    try {
                        await hands.send({ image: video });
                    } catch (error) {
                        console.error("Hand tracking failed:", error);
                    } finally {
                        sending = false;
                    }
                }
                requestAnimationFrame(nextFrame);
            };
            requestAnimationFrame(nextFrame);

            setStatus("Show your hand to begin", "ready");
            hideShade();
        } catch (error) {
            console.error("Camera failed to start:", error);
            fail("CAMERA UNAVAILABLE", "ALLOW CAMERA ACCESS ON LOCALHOST OR HTTPS, THEN RELOAD.");
        }
    }

    setColor(color);
    setBrushSize(brushSize);

    swatches.addEventListener("click", event => {
        const button = event.target.closest(".swatch");
        if (!button) return;
        setColor(button.dataset.color);
        setStatus(`COLOUR / ${button.getAttribute("aria-label").toUpperCase()}`, "ready", 900);
        logAction(`COLOUR / ${button.getAttribute("aria-label").toUpperCase()}`);
    });

    brushInput.addEventListener("input", () => {
        setBrushSize(Number(brushInput.value));
    });

    undoBtn.addEventListener("click", () => {
        if (undo()) logAction("STROKE / REMOVED");
    });
    clearBtn.addEventListener("click", () => {
        clearCanvas();
        logAction("CANVAS / CLEARED");
    });
    saveBtn.addEventListener("click", () => {
        saveImage();
        logAction("EXPORT / PNG SAVED");
    });

    document.addEventListener("keydown", event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
            event.preventDefault();
            if (undo()) logAction("STROKE / REMOVED");
        }
    });

    // Small test hook — useful for verifying gesture logic without a camera.
    window.HandDrawingDebug = {
        angleAt,
        distance,
        extendedFingers,
        classifyFlags,
        classifyGesture,
        brushFromPinch,
        isPinchPose,
        // Feed already-mapped canvas points through the real result handler.
        feed(points) {
            const raw = points.map(point => ({
                x: 1 - point.x / canvas.width,
                y: point.y / canvas.height,
                z: 0
            }));
            onResults({ multiHandLandmarks: [raw] });
        }
    };

    init();
})();
