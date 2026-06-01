const els = {
  imageInput: document.querySelector("#imageInput"),
  dropZone: document.querySelector("#dropZone"),
  sourcePreview: document.querySelector("#sourcePreview"),
  emptyPreview: document.querySelector("#emptyPreview"),
  generateBtn: document.querySelector("#generateBtn"),
  resultActions: document.querySelector("#resultActions"),
  reuploadBtn: document.querySelector("#reuploadBtn"),
  wakeBtn: document.querySelector("#wakeBtn"),
  identityForm: document.querySelector("#identityForm"),
  ipNameInput: document.querySelector("#ipNameInput"),
  chatForm: document.querySelector("#chatForm"),
  chatInput: document.querySelector("#chatInput"),
  chatLog: document.querySelector("#chatLog"),
  statusText: document.querySelector("#statusText"),
  errorText: document.querySelector("#errorText"),
  screen: document.querySelector(".screen"),
  screenPlaceholder: document.querySelector("#screenPlaceholder"),
  screenImage: document.querySelector("#screenImage"),
  screenVideo: document.querySelector("#screenVideo"),
  expressionLabel: document.querySelector("#expressionLabel"),
};

let selectedFile = null;
let selectedImageDataUrl = "";
let selectedSignature = null;
let lastGeneratedImageUrl = "";
let lastCacheMeta = null;
let activeCharacter = null;
let chatHistory = [];
let motionRequestId = 0;
let lastEmotion = null;
let typingTimerId = null;
let expressionTimerId = null;

const EMOTION_LABELS = {
  "低落/难过": { icon: "💧", color: "#7c8fa1" },
  "焦虑/紧张": { icon: "💫", color: "#b8a07c" },
  "生气/受挫": { icon: "🔥", color: "#c97060" },
  "开心/兴奋": { icon: "✨", color: "#7cb87c" },
  "疲惫/需要安抚": { icon: "🌙", color: "#9b8eb5" },
  "惊讶/好奇": { icon: "💡", color: "#7c9fc9" },
  "情绪强烈": { icon: "🌟", color: "#c9a07c" },
  "平静/好奇": { icon: "💭", color: "#8fa8b8" },
};

function setLoading(isLoading) {
  els.generateBtn.disabled = isLoading || (!selectedFile && !selectedImageDataUrl);
  els.generateBtn.textContent = isLoading ? "生成中..." : "生成像素角色";
  if (isLoading) {
    els.statusText.textContent = "生成中...";
  }
}

function showError(message) {
  els.errorText.textContent = message;
  els.errorText.hidden = !message;
}

function setSelectedFile(file) {
  selectedFile = file || null;
  selectedImageDataUrl = "";
  selectedSignature = null;
  lastGeneratedImageUrl = "";
  lastCacheMeta = null;
  activeCharacter = null;
  chatHistory = [];
  showError("");
  els.resultActions.hidden = true;
  els.identityForm.hidden = true;
  els.chatForm.hidden = true;
  els.chatLog.innerHTML = "";

  if (!selectedFile) {
    els.sourcePreview.removeAttribute("src");
    els.sourcePreview.hidden = true;
    els.emptyPreview.hidden = false;
    els.statusText.textContent = "";
    els.generateBtn.disabled = true;
    return;
  }

  const previewUrl = URL.createObjectURL(selectedFile);
  els.sourcePreview.src = previewUrl;
  els.sourcePreview.hidden = false;
  els.emptyPreview.hidden = true;
  els.statusText.textContent = `已选择：${selectedFile.name}`;
  els.generateBtn.disabled = false;

  fileToDataUrl(selectedFile)
    .then((dataUrl) => {
      selectedImageDataUrl = dataUrl;
      return imageDataUrlToSignature(dataUrl);
    })
    .then((signature) => {
      selectedSignature = signature;
    })
    .catch(() => {
      selectedImageDataUrl = "";
      selectedSignature = null;
    });
}

async function generatePixelCharacter() {
  const imagePayload = await getCurrentImagePayload();
  if (!imagePayload) {
    showError("请先上传一张 IP 实物图");
    return;
  }

  setLoading(true);
  showError("");

  try {
    const data = await requestGenerationDataUrl(imagePayload.dataUrl, "", imagePayload.signature, imagePayload.fileName);

    if (!data.imageUrl) {
      throw new Error(data.message || "生成失败，后端未返回图片");
    }

    lastGeneratedImageUrl = data.imageUrl;
    lastCacheMeta = data.cacheHit ? data : (data.generated ? data : null);
    showStaticCharacter(data.imageUrl);
    const ipLabel = data.identifiedIp?.ipName ? `，识别为 ${data.identifiedIp.ipName}` : "";
    const sourceLabel = data.cacheHit ? "已根据图片特征命中同 IP 缓存，直接使用保存好的角色图" : "AI 已根据实物图生成像素角色";
    els.statusText.textContent = `${sourceLabel}${ipLabel}`;
    els.resultActions.hidden = false;
  } catch (error) {
    showError(error.message || "生成失败，请稍后重试");
  } finally {
    setLoading(false);
  }
}

function resetForReupload() {
  clearTimeout(expressionTimerId);
  delete els.screen.dataset.savedVideoSrc;
  delete els.screen.dataset.savedImageSrc;
  selectedFile = null;
  selectedImageDataUrl = "";
  selectedSignature = null;
  lastGeneratedImageUrl = "";
  lastCacheMeta = null;
  activeCharacter = null;
  chatHistory = [];
  motionRequestId += 1;
  els.imageInput.value = "";
  els.sourcePreview.removeAttribute("src");
  els.sourcePreview.hidden = true;
  els.emptyPreview.hidden = false;
  els.screenImage.removeAttribute("src");
  els.screenImage.hidden = true;
  els.screenVideo.pause();
  els.screenVideo.removeAttribute("src");
  els.screenVideo.load();
  els.screenVideo.hidden = true;
  els.screenPlaceholder.hidden = false;
  els.generateBtn.disabled = true;
  els.resultActions.hidden = true;
  els.identityForm.hidden = true;
  els.chatForm.hidden = true;
  els.chatLog.innerHTML = "";
  els.ipNameInput.value = "";
  els.statusText.textContent = "请重新选择一张 IP 实物图";
  showError("");
  lastEmotion = null;
  resetScreenBackground();
  els.imageInput.focus();
}

function wakeCharacter() {
  if (!lastGeneratedImageUrl || !selectedSignature) {
    showError("请先生成满意的像素角色");
    return;
  }

  showError("");
  if (lastCacheMeta?.ipName) {
    const opening = buildOpeningLine(lastCacheMeta);
    activeCharacter = lastCacheMeta;
    els.statusText.textContent = opening;
    els.identityForm.hidden = true;
    showChat(opening);
    generateMotionForCurrentImage(lastGeneratedImageUrl);
    return;
  }

  els.identityForm.hidden = false;
  els.statusText.textContent = "你知道我是谁吗？请输入 IP 名称";
  els.ipNameInput.focus();
  generateMotionForCurrentImage(lastGeneratedImageUrl);
}

function buildOpeningLine(meta) {
  const name = meta.ipName || "我";
  const style = meta.styleName ? `「${meta.styleName}」` : "";
  if (meta.storySetting) {
    return `我是 ${name}${style}。${meta.storySetting}。现在，我醒来了。`;
  }
  if (meta.setting) {
    return `我是 ${name}${style}。${meta.setting}。现在，我醒来了。`;
  }
  return `我是 ${name}${style}。现在，我醒来了。`;
}

async function saveIdentity(ipName) {
  if (!lastGeneratedImageUrl || !selectedSignature) {
    showError("请先生成满意的像素角色");
    return;
  }

  const cleanIpName = ipName.trim();
  if (!cleanIpName) {
    showError("请输入 IP 名称");
    return;
  }

  if (lastCacheMeta?.cacheHit) {
    activeCharacter = lastCacheMeta;
    els.identityForm.hidden = true;
    showChat(buildOpeningLine(lastCacheMeta));
    els.statusText.textContent = "已使用缓存角色，无需重复保存";
    return;
  }

  els.statusText.textContent = "保存中...";
  showError("");
  els.wakeBtn.disabled = true;

  try {
    const response = await fetch("/api/confirm-wake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageUrl: lastGeneratedImageUrl,
        referenceImage: selectedImageDataUrl,
        signature: selectedSignature,
        ipName: cleanIpName,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "保存失败，请稍后重试");

    lastGeneratedImageUrl = data.imageUrl || lastGeneratedImageUrl;
    els.identityForm.hidden = true;
    activeCharacter = {
      ipName: cleanIpName,
      imageUrl: lastGeneratedImageUrl,
      styleName: data.styleName || "",
      storySetting: data.storySetting || "",
      setting: data.setting || "",
      ipKey: data.ipKey || (data.identifiedIp?.ipKey) || cleanIpName.toLowerCase().replace(/[^\p{L}\p{N}_-]/gu, ""),
    };
    els.statusText.textContent = `已保存为 ${cleanIpName}，后续选择或识别到相同 IP 将直接使用该图`;
    showChat(`我是 ${cleanIpName}。现在，我醒来了。`);
  } catch (error) {
    showError(error.message || "保存失败，请稍后重试");
    els.statusText.textContent = "";
  } finally {
    els.wakeBtn.disabled = false;
  }
}

function showStaticCharacter(imageUrl) {
  clearTimeout(expressionTimerId);
  els.expressionLabel.hidden = true;
  motionRequestId += 1;
  els.screenVideo.pause();
  els.screenVideo.removeAttribute("src");
  els.screenVideo.load();
  els.screenVideo.hidden = true;
  els.screenImage.src = imageUrl;
  els.screenImage.hidden = false;
  els.screenPlaceholder.hidden = true;
  resetScreenBackground();
}

function resetScreenBackground() {
  els.screen.style.transition = "background 0.3s ease";
  els.screen.style.background = "#ffffff";
}

function showMotionCharacter(videoUrl) {
  clearTimeout(expressionTimerId);
  els.expressionLabel.hidden = true;
  els.screenVideo.onerror = () => {
    showError("视频已生成，但浏览器加载失败，请重新点一次确定唤醒");
  };
  els.screenVideo.src = videoUrl;
  els.screenVideo.hidden = false;
  els.screenImage.removeAttribute("src");
  els.screenImage.hidden = true;
  els.screenPlaceholder.hidden = true;
  els.screenVideo.play().catch(() => {});
}

async function generateMotionForCurrentImage(imageUrl) {
  if (!imageUrl) return;

  const requestId = ++motionRequestId;
  const currentStatus = els.statusText.textContent.trim();
  els.statusText.textContent = currentStatus ? `${currentStatus}，唤醒动效生成中...` : "唤醒动效生成中...";
  els.wakeBtn.disabled = true;

  try {
    const response = await fetch("/api/generate-character-motion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl: imageUrl }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || `动效生成失败：HTTP ${response.status}`);
    if (!data.videoUrl) throw new Error("动效生成失败");
    if (requestId !== motionRequestId) return;

    els.statusText.textContent = data.cachedMotion
      ? "已使用保存过的本地动效，正在加载视频..."
      : data.videoUrl.startsWith("/ip-cache/")
      ? "动效生成成功，已保存到本地，正在加载视频..."
      : "动效生成成功，正在加载视频...";
    showMotionCharacter(data.videoUrl);
    els.statusText.textContent = "唤醒成功，已切换为眨眼动图";
  } catch (error) {
    if (requestId === motionRequestId) {
      showError(error.message || "动效生成失败，请稍后重试");
      els.statusText.textContent = "动效生成失败，已保留静态图";
    }
  } finally {
    if (requestId === motionRequestId) {
      els.wakeBtn.disabled = false;
    }
  }
}

function showCharacterExpression(expressionUrl, expressionVideoUrl) {
  if (!expressionUrl) return;
  console.log("[Expr] showCharacterExpression called image:", expressionUrl, "video:", expressionVideoUrl);

  // Extract expression name from URL and show label
  const exprName = expressionUrl.split("/").pop().replace(/\.\w+$/, "");
  const EMOTION_ICONS = { "开心":"😊","生气":"😤","伤心":"😢","困惑":"🤔","惊讶":"😮","疲惫":"😴","微笑":"🙂","犯困":"😪" };
  els.expressionLabel.textContent = (EMOTION_ICONS[exprName] || "") + " " + exprName;
  els.expressionLabel.hidden = false;

  clearTimeout(expressionTimerId);
  if (!els.screenVideo.hidden && els.screenVideo.getAttribute("src")) {
    els.screen.dataset.savedVideoSrc = els.screenVideo.getAttribute("src");
  } else if (!els.screenImage.hidden && els.screenImage.getAttribute("src")) {
    els.screen.dataset.savedImageSrc = els.screenImage.getAttribute("src");
  }

  if (expressionVideoUrl) {
    // Play expression video
    els.screenImage.removeAttribute("src");
    els.screenImage.hidden = true;
    els.screenVideo.src = expressionVideoUrl;
    els.screenVideo.hidden = false;
    els.screenPlaceholder.hidden = true;
    els.screenVideo.play().catch(() => {
      // Fallback to static image if video fails
      els.screenVideo.hidden = true;
      els.screenImage.src = expressionUrl;
      els.screenImage.hidden = false;
    });
  } else {
    // Static image fallback
    els.screenVideo.pause();
    els.screenVideo.hidden = true;
    els.screenImage.src = expressionUrl;
    els.screenImage.hidden = false;
    els.screenPlaceholder.hidden = true;
  }
  expressionTimerId = setTimeout(revertCharacterExpression, 8000);
}

function revertCharacterExpression() {
  const savedVideoSrc = els.screen.dataset.savedVideoSrc || "";
  const savedImageSrc = els.screen.dataset.savedImageSrc || "";
  if (savedVideoSrc) {
    els.screenVideo.src = savedVideoSrc;
    els.screenVideo.hidden = false;
    els.screenImage.removeAttribute("src");
    els.screenImage.hidden = true;
    els.screenPlaceholder.hidden = true;
    els.screenVideo.play().catch(() => {});
  } else if (savedImageSrc) {
    els.screenVideo.pause();
    els.screenVideo.removeAttribute("src");
    els.screenVideo.hidden = true;
    els.screenImage.src = savedImageSrc;
    els.screenImage.hidden = false;
    els.screenPlaceholder.hidden = true;
  } else {
    els.screenImage.hidden = true;
    els.screenVideo.hidden = true;
    els.screenPlaceholder.hidden = false;
  }
  delete els.screen.dataset.savedVideoSrc;
  delete els.screen.dataset.savedImageSrc;
  els.expressionLabel.hidden = true;
  expressionTimerId = null;
}

function showChat(opening) {
  els.chatForm.hidden = false;
  els.chatLog.innerHTML = "";
  chatHistory = [];
  addChatMessage("bot", opening);
  rememberChatMessage("assistant", opening);
  els.chatInput.focus();
}

function addChatMessage(role, text, emotion) {
  const message = document.createElement("div");
  message.className = `chat-message ${role}`;
  if (role === "bot" && emotion) {
    const info = EMOTION_LABELS[emotion.label];
    if (info) {
      const badge = document.createElement("span");
      badge.className = "emotion-badge";
      badge.textContent = `${info.icon} ${emotion.label}`;
      badge.style.setProperty("--emotion-color", info.color);
      message.append(badge);
    }
  }
  const textSpan = document.createElement("span");
  textSpan.className = "message-text";
  textSpan.textContent = text;
  message.append(textSpan);
  els.chatLog.append(message);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

async function sendChatMessage(text) {
  const question = text.trim();
  if (!question || !activeCharacter) return;

  addChatMessage("user", question);
  rememberChatMessage("user", question);
  els.chatInput.value = "";
  els.chatInput.disabled = true;
  showTypingIndicator();

  try {
    const response = await fetch("/api/chat-character", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: question,
        character: activeCharacter,
        history: chatHistory.slice(0, -1),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "回复失败，请稍后重试");
    const reply = data.reply || "我听见了。";
    const emotion = data.emotion || null;

    removeTypingIndicator();
    if (emotion) {
      lastEmotion = emotion;
      addChatMessage("bot", reply, emotion);
      applyEmotionScreenEffect(emotion);
      if (data.expressionUrl) {
        console.log("[Expr] expressionUrl received:", data.expressionUrl, "video:", data.expressionVideoUrl);
        showCharacterExpression(data.expressionUrl, data.expressionVideoUrl);
      } else {
        console.log("[Expr] no expressionUrl in response, emotion:", emotion.label);
      }
    } else {
      addChatMessage("bot", reply);
    }
    rememberChatMessage("assistant", reply);
  } catch (error) {
    removeTypingIndicator();
    const fallback = error.message || "回复失败，请稍后重试";
    addChatMessage("bot", fallback);
    rememberChatMessage("assistant", fallback);
  } finally {
    els.chatInput.disabled = false;
    els.chatInput.focus();
  }
}

function showTypingIndicator() {
  const indicator = document.createElement("div");
  indicator.className = "chat-message bot typing-indicator";
  indicator.id = "typingIndicator";
  indicator.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
  els.chatLog.append(indicator);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function removeTypingIndicator() {
  const indicator = document.getElementById("typingIndicator");
  if (indicator) indicator.remove();
}

function applyEmotionScreenEffect(emotion) {
  const info = EMOTION_LABELS[emotion.label];
  if (!info || emotion.label === "平静/好奇") {
    els.screen.style.transition = "background 0.6s ease";
    els.screen.style.background = "#ffffff";
    return;
  }
  els.screen.style.transition = "background 0.8s ease";
  els.screen.style.background = info.color + "15";
  clearTimeout(typingTimerId);
  typingTimerId = setTimeout(() => {
    els.screen.style.transition = "background 1.2s ease";
    els.screen.style.background = "#ffffff";
  }, 3000);
}

function rememberChatMessage(role, content) {
  chatHistory.push({ role, content });
  if (chatHistory.length > 10) {
    chatHistory = chatHistory.slice(-10);
  }
}

async function getCurrentImagePayload() {
  const file = selectedFile || els.imageInput.files?.[0];
  if (file) {
    selectedFile = file;
    if (!selectedImageDataUrl) {
      selectedImageDataUrl = await fileToDataUrl(file);
    }
    if (!selectedSignature) {
      selectedSignature = await imageDataUrlToSignature(selectedImageDataUrl);
    }
    return { file, dataUrl: selectedImageDataUrl, signature: selectedSignature, fileName: file.name || "" };
  }

  if (selectedImageDataUrl) {
    if (!selectedSignature) {
      selectedSignature = await imageDataUrlToSignature(selectedImageDataUrl);
    }
    return { file: null, dataUrl: selectedImageDataUrl, signature: selectedSignature, fileName: "" };
  }

  const previewSrc = els.sourcePreview.getAttribute("src");
  if (!previewSrc) return null;

  if (previewSrc.startsWith("data:image/")) {
    selectedImageDataUrl = previewSrc;
    selectedSignature = await imageDataUrlToSignature(selectedImageDataUrl);
    return { file: null, dataUrl: selectedImageDataUrl, signature: selectedSignature, fileName: "" };
  }

  if (previewSrc.startsWith("blob:")) {
    const response = await fetch(previewSrc);
    const blob = await response.blob();
    selectedImageDataUrl = await fileToDataUrl(blob);
    selectedSignature = await imageDataUrlToSignature(selectedImageDataUrl);
    return { file: null, dataUrl: selectedImageDataUrl, signature: selectedSignature, fileName: "" };
  }

  return null;
}

async function requestGeneration(file) {
  const formData = new FormData();
  formData.append("image", file);

  const response = await fetch("/api/generate-pixel-character", {
    method: "POST",
    body: formData,
  });
  const data = await response.json().catch(() => ({}));

  if (response.ok) return data;

  return requestGenerationAsJson(file, data.message);
}

async function requestGenerationAsJson(file, previousMessage) {
  const imageBase64 = selectedImageDataUrl || (await fileToDataUrl(file));
  return requestGenerationDataUrl(imageBase64, previousMessage);
}

async function requestGenerationDataUrl(imageBase64, previousMessage, signature = selectedSignature, fileName = selectedFile?.name || "") {
  const response = await fetch("/api/generate-pixel-character", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64, signature, fileName }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || data.error || previousMessage || "生成失败，请稍后重试");
  }

  return data;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function imageDataUrlToSignature(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      canvas.width = 8;
      canvas.height = 8;
      ctx.drawImage(image, 0, 0, 8, 8);
      const data = ctx.getImageData(0, 0, 8, 8).data;
      const signature = [];
      for (let i = 0; i < data.length; i += 4) {
        signature.push(data[i], data[i + 1], data[i + 2]);
      }
      resolve(signature);
    };
    image.onerror = reject;
    image.src = dataUrl;
  });
}


els.imageInput.addEventListener("change", (event) => {
  setSelectedFile(event.target.files?.[0]);
});

els.generateBtn.addEventListener("click", () => {
  generatePixelCharacter();
});

els.reuploadBtn.addEventListener("click", () => {
  resetForReupload();
});

els.wakeBtn.addEventListener("click", () => {
  wakeCharacter();
});

els.identityForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveIdentity(els.ipNameInput.value);
});

els.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendChatMessage(els.chatInput.value);
});

["dragenter", "dragover"].forEach((eventName) => {
  els.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropZone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  els.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropZone.classList.remove("is-dragging");
  });
});

els.dropZone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files?.[0];
  if (file) {
    setSelectedFile(file);
  }
});
