// ==========================================================================
// Stream Studio — Luxury Dark Reference Frontend Engine
// Constellation Parallax · Multi-Socket Progress Stream · Full API Hookup
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {

  // ─── DOM References ───
  const videoUrlInput          = document.getElementById('videoUrlInput');
  const pasteBtn               = document.getElementById('pasteBtn');
  const clearBtn               = document.getElementById('clearBtn');
  const fetchBtn               = document.getElementById('fetchBtn');
  const btnText                = fetchBtn ? fetchBtn.querySelector('.btn-text') : null;
  const btnSpinner             = fetchBtn ? fetchBtn.querySelector('.btn-spinner') : null;
  const discoverBtn            = document.getElementById('discoverBtn');

  const errorBanner            = document.getElementById('errorBanner');
  const errorTitle             = document.getElementById('errorTitle');
  const errorMessage           = document.getElementById('errorMessage');
  const closeErrorBtn          = document.getElementById('closeErrorBtn');

  const resultSection          = document.getElementById('resultSection');
  const videoThumb             = document.getElementById('videoThumb');
  const videoDuration          = document.getElementById('videoDuration');
  const siteBadge              = document.getElementById('siteBadge');
  const siteName               = document.getElementById('siteName');
  const videoTitle             = document.getElementById('videoTitle');
  const videoUploader          = document.getElementById('videoUploader');
  const videoViews             = document.getElementById('videoViews');
  const viewsContainer         = document.getElementById('viewsContainer');
  const maxQualityBadge        = document.getElementById('maxQualityBadge');

  const toggleSegmentBtns      = document.querySelectorAll('.toggle-segment-btn');
  const tabPanes               = document.querySelectorAll('.tab-pane');
  const videoFormatsGrid       = document.getElementById('videoFormatsGrid');
  const audioFormatsGrid       = document.getElementById('audioFormatsGrid');

  const activeDownloadsSection = document.getElementById('activeDownloadsSection');
  const activeDownloadsList    = document.getElementById('activeDownloadsList');

  const openFolderBtn          = document.getElementById('openFolderBtn');
  const toggleHistoryBtn       = document.getElementById('toggleHistoryBtn');
  const historyCount           = document.getElementById('historyCount');
  const historyDrawer          = document.getElementById('historyDrawer');
  const drawerOverlay          = document.getElementById('drawerOverlay');
  const closeHistoryBtn        = document.getElementById('closeHistoryBtn');
  const openFolderDrawerBtn    = document.getElementById('openFolderDrawerBtn');
  const historyList            = document.getElementById('historyList');

  const cancelConfirmModal     = document.getElementById('cancelConfirmModal');
  const cancelConfirmText      = document.getElementById('cancelConfirmText');
  const cancelConfirmNoBtn     = document.getElementById('cancelConfirmNoBtn');
  const cancelConfirmYesBtn    = document.getElementById('cancelConfirmYesBtn');
  let pendingCancelDownloadId  = null;

  const toastContainer         = document.getElementById('toastContainer');
  const constellationNodes     = document.querySelectorAll('.constellation-node');

  // Application State
  let currentVideoData = null;
  const activeEventSources = new Map();

  // ══════════════════════════════════════════════════════════════
  // 1. CONSTELLATION NODE MOUSE PARALLAX
  // ══════════════════════════════════════════════════════════════
  if (constellationNodes.length > 0) {
    window.addEventListener('mousemove', (e) => {
      const x = (e.clientX - window.innerWidth / 2) / 45;
      const y = (e.clientY - window.innerHeight / 2) / 45;

      constellationNodes.forEach((node, index) => {
        const factor = (index % 2 === 0 ? 1 : -1) * 0.7;
        node.style.transform = `translate(${x * factor}px, ${y * factor}px)`;
      });
    });
  }

  // ─── Security: HTML Sanitization Helpers ───
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeAttr(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ══════════════════════════════════════════════════════════════
  // 2. TOAST NOTIFICATIONS SYSTEM
  // ══════════════════════════════════════════════════════════════
  function showToast(message, type = 'info', icon = 'fa-circle-info') {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    const safeType = ['info', 'success', 'warning', 'error'].includes(type) ? type : 'info';
    toast.className = `toast ${safeType}`;

    const iconEl = document.createElement('i');
    iconEl.className = `fa-solid ${escapeAttr(icon)}`;

    const textEl = document.createElement('span');
    textEl.textContent = String(message || '');

    toast.appendChild(iconEl);
    toast.appendChild(textEl);
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 3800);
  }

  // ─── Error Banner Handlers ───
  function showError(title, msg) {
    if (!errorBanner) return;
    if (errorTitle) errorTitle.textContent = title;
    if (errorMessage) errorMessage.textContent = msg;
    errorBanner.classList.remove('hidden');
    if (resultSection) resultSection.classList.add('hidden');
  }

  function hideError() {
    if (errorBanner) errorBanner.classList.add('hidden');
  }

  if (closeErrorBtn) {
    closeErrorBtn.addEventListener('click', hideError);
  }

  // ══════════════════════════════════════════════════════════════
  // 3. COMMAND INPUT & KEYBOARD SHORTCUTS
  // ══════════════════════════════════════════════════════════════
  if (videoUrlInput) {
    videoUrlInput.addEventListener('input', () => {
      if (clearBtn) {
        clearBtn.classList.toggle('hidden', videoUrlInput.value.trim().length === 0);
      }
    });

    videoUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') analyzeVideo();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (videoUrlInput) {
        videoUrlInput.value = '';
        clearBtn.classList.add('hidden');
        videoUrlInput.focus();
      }
    });
  }

  if (pasteBtn) {
    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text.trim().startsWith('http')) {
          if (videoUrlInput) {
            videoUrlInput.value = text.trim();
            if (clearBtn) clearBtn.classList.remove('hidden');
            showToast('Stream URL pasted!', 'success', 'fa-check');
            analyzeVideo();
          }
        } else {
          showToast('No valid URL found in clipboard', 'info', 'fa-copy');
        }
      } catch (err) {
        if (videoUrlInput) videoUrlInput.focus();
        showToast('Press Ctrl+V to paste link', 'info', 'fa-keyboard');
      }
    });
  }

  // Global Ctrl+V Shortcut
  document.addEventListener('keydown', async (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      if (document.activeElement !== videoUrlInput) {
        try {
          const text = await navigator.clipboard.readText();
          if (text && text.trim().startsWith('http') && videoUrlInput) {
            videoUrlInput.value = text.trim();
            if (clearBtn) clearBtn.classList.remove('hidden');
            showToast('Stream URL pasted!', 'success', 'fa-check');
            videoUrlInput.focus();
            analyzeVideo();
          }
        } catch (err) {}
      }
    }
  });

  if (fetchBtn) {
    fetchBtn.addEventListener('click', analyzeVideo);
  }

  if (discoverBtn) {
    discoverBtn.addEventListener('click', () => {
      if (videoUrlInput && videoUrlInput.value.trim().length > 0) {
        analyzeVideo();
      } else {
        videoUrlInput.focus();
        showToast('Paste a video link above to discover formats', 'info', 'fa-wand-magic-sparkles');
      }
    });
  }

  // Segmented Format Toggle
  toggleSegmentBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      toggleSegmentBtns.forEach((b) => b.classList.remove('active'));
      tabPanes.forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById(btn.dataset.tab);
      if (target) target.classList.add('active');
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 4. STREAM EXTRACTION & ANALYSIS
  // ══════════════════════════════════════════════════════════════
  async function analyzeVideo() {
    if (!videoUrlInput) return;
    let url = videoUrlInput.value.trim();

    if (!url) {
      showError('No Link Entered', 'Please paste a valid video URL from any supported media network.');
      videoUrlInput.focus();
      return;
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      if (url.startsWith('//')) {
        url = 'https:' + url;
      } else if (url.includes('.') && !url.startsWith('?')) {
        url = 'https://' + url;
      }
    }

    if (url.startsWith('?') || !url.startsWith('http')) {
      showError('Incomplete URL', 'Please paste the full video URL including domain name.');
      videoUrlInput.focus();
      return;
    }

    videoUrlInput.value = url;
    hideError();
    setLoading(true);

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        if (res.status === 429) {
          const retrySec = json.retryAfter || 15;
          showToast(`Rate limit reached: Please wait ${retrySec}s`, 'warning', 'fa-clock');
          showError('Rate Limit Exceeded', json.error || `Please wait ${retrySec} seconds before inspecting another URL.`);
          return;
        }
        throw new Error(json.error || 'Failed to inspect stream metadata.');
      }

      currentVideoData = json.data;
      renderVideoResult(json.data);
      showToast('Stream analysis complete!', 'success', 'fa-circle-check');
    } catch (err) {
      showError('Extraction Failed', err.message || 'Could not fetch stream metadata.');
    } finally {
      setLoading(false);
    }
  }

  function setLoading(isLoading) {
    if (!fetchBtn) return;
    fetchBtn.disabled = isLoading;
    fetchBtn.classList.toggle('is-extracting', isLoading);
    const inputCapsule = document.querySelector('.command-input-capsule');
    if (inputCapsule) inputCapsule.classList.toggle('is-scanning', isLoading);
    if (btnText) btnText.classList.toggle('hidden', isLoading);
    if (btnSpinner) btnSpinner.classList.toggle('hidden', !isLoading);
  }

  // ══════════════════════════════════════════════════════════════
  // 5. RENDER VIDEO RESULT
  // ══════════════════════════════════════════════════════════════
  function renderVideoResult(data) {
    if (!resultSection) return;

    if (videoTitle) videoTitle.textContent = data.title || 'Untitled Stream';
    if (videoThumb) {
      const thumbUrl = data.thumbnail || '';
      if (thumbUrl.startsWith('http') && !thumbUrl.includes('/api/proxy-image')) {
        videoThumb.src = `/api/proxy-image?url=${encodeURIComponent(thumbUrl)}`;
      } else {
        videoThumb.src = thumbUrl || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="%2311141c"/><text x="50%" y="50%" fill="%23a8ceb9" font-size="22" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">▶ Stream Preview</text></svg>';
      }
      videoThumb.onerror = () => {
        videoThumb.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="%2311141c"/><text x="50%" y="50%" fill="%23a8ceb9" font-size="22" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">▶ Stream Preview</text></svg>';
      };
    }

    if (videoDuration) videoDuration.textContent = data.durationFormatted || '00:00';
    if (videoUploader) videoUploader.textContent = data.uploader || 'Channel';
    if (siteName) siteName.textContent = data.site || 'Web';

    if (viewsContainer && videoViews) {
      if (data.viewCount) {
        videoViews.textContent = `${data.viewCount} views`;
        viewsContainer.classList.remove('hidden');
      } else {
        viewsContainer.classList.add('hidden');
      }
    }

    // Quality Badge
    if (maxQualityBadge) {
      const has8K = (data.videoFormats || []).some((f) => f.height >= 4320 || f.badge === '8K');
      const has4K = (data.videoFormats || []).some((f) => f.height >= 2160 || f.badge === '4K');
      const has2K = (data.videoFormats || []).some((f) => f.height >= 1440 || f.badge === '2K');

      if (has8K) {
        maxQualityBadge.innerHTML = `<i class="fa-solid fa-crown"></i><span>8K Ultra HD</span>`;
      } else if (has4K) {
        maxQualityBadge.innerHTML = `<i class="fa-solid fa-crown"></i><span>4K Ultra HD</span>`;
      } else if (has2K) {
        maxQualityBadge.innerHTML = `<i class="fa-solid fa-star"></i><span>2K Quad HD</span>`;
      } else {
        maxQualityBadge.innerHTML = `<i class="fa-solid fa-sparkles"></i><span>1080p Full HD</span>`;
      }
      maxQualityBadge.classList.remove('hidden');
    }

    // Render Video Format Rows
    if (videoFormatsGrid) {
      videoFormatsGrid.innerHTML = '';
      if (!data.videoFormats || data.videoFormats.length === 0) {
        videoFormatsGrid.innerHTML = `<div class="empty-history-placeholder"><p>No standard video formats detected.</p></div>`;
      } else {
        data.videoFormats.forEach((f) => {
          const is8k = f.height >= 4320 || f.badge === '8K';
          const is4k = f.height >= 2160 || f.badge === '4K';
          const row = document.createElement('div');
          row.className = `stream-format-row ${is8k ? 'is-8k' : is4k ? 'is-4k' : ''}`;

          let fpsLabel = f.fps && f.fps >= 50 ? `${escapeHtml(f.fps)}fps • ` : '';

          row.innerHTML = `
            <div class="row-left-details">
              <div class="res-tag-badge">${escapeHtml(f.badge || 'HD')}</div>
              <div class="format-text-meta">
                <h4>${escapeHtml(f.label || 'Standard Video')}</h4>
                <p>${fpsLabel}MP4 Video Stream • Lossless Mux</p>
              </div>
            </div>
            <div class="row-right-actions">
              <span class="file-size-indicator">${escapeHtml(f.sizeFormatted || 'Original Bitrate')}</span>
              ${f.directUrl ? `
                <button class="copy-direct-btn" data-url="${escapeAttr(f.directUrl)}" title="Copy Direct Stream Link">
                  <i class="fa-solid fa-link"></i>
                  <span>Copy</span>
                </button>
              ` : ''}
              <button class="download-stream-btn" data-type="video" data-id="${escapeAttr(f.formatId || '')}" data-height="${escapeAttr(f.height || '')}" data-direct-url="${escapeAttr(f.directUrl || '')}">
                <i class="fa-solid fa-arrow-down"></i>
                <span>Download</span>
              </button>
            </div>
          `;
          videoFormatsGrid.appendChild(row);
        });
      }
    }

    // Render Audio Format Rows
    if (audioFormatsGrid) {
      audioFormatsGrid.innerHTML = '';
      if (!data.audioFormats || data.audioFormats.length === 0) {
        const row = document.createElement('div');
        row.className = 'stream-format-row';
        row.innerHTML = `
          <div class="row-left-details">
            <div class="res-tag-badge">MP3</div>
            <div class="format-text-meta">
              <h4>Master Audio (Highest Quality)</h4>
              <p>MP3 Audio • Studio Bitrate</p>
            </div>
          </div>
          <div class="row-right-actions">
            <span class="file-size-indicator">320 kbps</span>
            <button class="download-stream-btn" data-type="audio" data-id="bestaudio">
              <i class="fa-solid fa-music"></i>
              <span>Download MP3</span>
            </button>
          </div>
        `;
        audioFormatsGrid.appendChild(row);
      } else {
        data.audioFormats.slice(0, 4).forEach((a) => {
          const row = document.createElement('div');
          row.className = 'stream-format-row';
          row.innerHTML = `
            <div class="row-left-details">
              <div class="res-tag-badge">MP3</div>
              <div class="format-text-meta">
                <h4>MP3 Master Audio (${escapeHtml(a.quality || 'HQ')})</h4>
                <p>${escapeHtml(a.codec || 'Audio Stream')} • Lossless Extraction</p>
              </div>
            </div>
            <div class="row-right-actions">
              <span class="file-size-indicator">${escapeHtml(a.sizeFormatted || 'Highest Quality')}</span>
              ${a.directUrl ? `
                <button class="copy-direct-btn" data-url="${escapeAttr(a.directUrl)}" title="Copy Direct Audio Link">
                  <i class="fa-solid fa-link"></i>
                  <span>Copy</span>
                </button>
              ` : ''}
              <button class="download-stream-btn" data-type="audio" data-id="${escapeAttr(a.formatId || '')}" data-direct-url="${escapeAttr(a.directUrl || '')}">
                <i class="fa-solid fa-music"></i>
                <span>Download MP3</span>
              </button>
            </div>
          `;
          audioFormatsGrid.appendChild(row);
        });
      }
    }

    // Attach Copy Link Listeners
    document.querySelectorAll('.copy-direct-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const url = btn.dataset.url;
        if (url) {
          try {
            await navigator.clipboard.writeText(url);
            showToast('Direct stream link copied to clipboard!', 'success', 'fa-copy');
          } catch (err) {
            showToast('Could not copy link.', 'error', 'fa-triangle-exclamation');
          }
        }
      });
    });

    // Attach Download Listeners
    document.querySelectorAll('.download-stream-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const isAudio = btn.dataset.type === 'audio';
        const formatId = btn.dataset.id;
        const height = btn.dataset.height;
        const directUrl = btn.dataset.directUrl;
        startDownload({ isAudio, formatId, height, directUrl });
      });
    });

    resultSection.classList.remove('hidden');
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ══════════════════════════════════════════════════════════════
  // 6. START DOWNLOAD PIPELINE
  // ══════════════════════════════════════════════════════════════
  async function startDownload({ isAudio, formatId, height, directUrl }) {
    if (!currentVideoData) return;

    showToast('Initializing 16-socket stream worker...', 'info', 'fa-bolt');
    if (activeDownloadsSection) activeDownloadsSection.classList.remove('hidden');

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: currentVideoData.webpageUrl,
          title: currentVideoData.title,
          formatId: formatId,
          height: height,
          isAudio: isAudio,
          directUrl: directUrl || null,
          ext: isAudio ? 'mp3' : 'mp4'
        })
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        if (res.status === 429) {
          const retrySec = json.retryAfter || 15;
          showToast(json.error || `Download rate limit reached. Please wait ${retrySec}s.`, 'warning', 'fa-clock');
          return;
        }
        throw new Error(json.error || 'Could not start download pipeline.');
      }

      createActiveDownloadCard(json.downloadId, currentVideoData.title, isAudio);
      subscribeToProgress(json.downloadId);
      loadHistory();
    } catch (err) {
      showToast(err.message || 'Stream download failed to initialize.', 'error', 'fa-triangle-exclamation');
    }
  }

  // ─── Create Active Pipeline Card ───
  function createActiveDownloadCard(downloadId, title, isAudio) {
    if (!activeDownloadsList) return;

    const safeId = escapeAttr(downloadId);
    const safeTitle = escapeHtml(title || 'Stream');

    const card = document.createElement('div');
    card.className = 'pipeline-download-card';
    card.id = `download-${safeId}`;
    card.innerHTML = `
      <div class="pipeline-header">
        <div class="pipeline-title">
          <i class="fa-solid ${isAudio ? 'fa-music' : 'fa-film'}"></i>
          <span>${safeTitle}</span>
        </div>
        <div class="pipeline-actions-right">
          <span class="status-pill" id="status-badge-${safeId}">Starting</span>
          <button class="cancel-stream-btn" id="cancel-btn-${safeId}" title="Stop download">
            <i class="fa-solid fa-xmark"></i>
            <span>Cancel</span>
          </button>
        </div>
      </div>
      
      <div class="progress-flow-wrap">
        <div class="progress-flow-track">
          <div class="progress-flow-fill" id="progress-bar-${safeId}" style="width: 0%;"></div>
        </div>
        <div class="progress-flow-meta">
          <span id="progress-text-${safeId}">0% • Initializing 16-socket pipeline...</span>
          <span id="speed-text-${safeId}">-- MB/s • ETA: --</span>
        </div>
      </div>

      <div class="completed-action-row hidden" id="actions-${safeId}">
        <a href="/api/file/${safeId}" class="save-file-cta" download>
          <i class="fa-solid fa-cloud-arrow-down"></i>
          <span>Save to Device</span>
        </a>
      </div>
    `;

    // Cancel Button Click
    const cancelBtn = card.querySelector(`#cancel-btn-${downloadId}`);
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        pendingCancelDownloadId = downloadId;
        if (cancelConfirmText) cancelConfirmText.textContent = `Are you sure you want to cancel the download for "${title}"?`;
        if (cancelConfirmModal) cancelConfirmModal.classList.remove('hidden');
      });
    }

    activeDownloadsList.prepend(card);
    if (activeDownloadsSection) activeDownloadsSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ─── Cancel Confirmation Handlers ───
  if (cancelConfirmNoBtn) {
    cancelConfirmNoBtn.addEventListener('click', () => {
      if (cancelConfirmModal) cancelConfirmModal.classList.add('hidden');
      pendingCancelDownloadId = null;
    });
  }

  if (cancelConfirmModal) {
    cancelConfirmModal.addEventListener('click', (e) => {
      if (e.target === cancelConfirmModal) {
        cancelConfirmModal.classList.add('hidden');
        pendingCancelDownloadId = null;
      }
    });
  }

  if (cancelConfirmYesBtn) {
    cancelConfirmYesBtn.addEventListener('click', async () => {
      if (!pendingCancelDownloadId) return;
      const id = pendingCancelDownloadId;
      if (cancelConfirmModal) cancelConfirmModal.classList.add('hidden');
      pendingCancelDownloadId = null;

      showToast('Halting download stream...', 'info', 'fa-ban');

      try {
        await fetch(`/api/download/cancel/${id}`, { method: 'POST' });

        const badge = document.getElementById(`status-badge-${id}`);
        const bar = document.getElementById(`progress-bar-${id}`);
        const progressText = document.getElementById(`progress-text-${id}`);
        const speedText = document.getElementById(`speed-text-${id}`);
        const cancelBtn = document.getElementById(`cancel-btn-${id}`);

        if (badge) {
          badge.textContent = 'Cancelled';
          badge.className = 'status-pill cancelled';
        }
        if (bar) {
          bar.style.width = '100%';
          bar.className = 'progress-flow-fill cancelled';
        }
        if (progressText) progressText.textContent = 'Download stopped by user';
        if (speedText) speedText.textContent = 'Cancelled';
        if (cancelBtn) cancelBtn.classList.add('hidden');

        const es = activeEventSources.get(id);
        if (es) {
          es.close();
          activeEventSources.delete(id);
        }

        showToast('Download cancelled.', 'info', 'fa-circle-check');
      } catch (err) {
        showToast('Could not cancel download.', 'error', 'fa-triangle-exclamation');
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  // 7. SSE REAL-TIME PROGRESS STREAM
  // ══════════════════════════════════════════════════════════════
  function subscribeToProgress(downloadId) {
    const eventSource = new EventSource(`/api/progress/${downloadId}`);
    activeEventSources.set(downloadId, eventSource);

    const badge = document.getElementById(`status-badge-${downloadId}`);
    const bar = document.getElementById(`progress-bar-${downloadId}`);
    const progressText = document.getElementById(`progress-text-${downloadId}`);
    const speedText = document.getElementById(`speed-text-${downloadId}`);
    const actions = document.getElementById(`actions-${downloadId}`);
    const cancelBtn = document.getElementById(`cancel-btn-${downloadId}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const percent = Math.min(100, Math.max(0, data.percent || 0));

        if (bar && data.status !== 'cancelled') bar.style.width = `${percent}%`;

        if (data.status === 'downloading') {
          if (badge) {
            badge.textContent = 'Downloading';
            badge.className = 'status-pill downloading';
          }
          if (progressText) progressText.textContent = `${percent.toFixed(1)}% of ${data.totalSize || '--'}`;
          if (speedText) speedText.textContent = `${data.speed || '--'} • ETA: ${data.eta || '--'}`;
        } else if (data.status === 'merging') {
          if (badge) {
            badge.textContent = 'Merging Bitstreams';
            badge.className = 'status-pill merging';
          }
          if (bar) bar.classList.add('merging');
          if (progressText) progressText.textContent = 'Merging video & audio streams with FFmpeg...';
          if (speedText) speedText.textContent = 'Hardware Acceleration';
        } else if (data.status === 'completed') {
          if (badge) {
            badge.textContent = 'Completed';
            badge.className = 'status-pill completed';
          }
          if (bar) {
            bar.style.width = '100%';
            bar.classList.remove('merging');
          }
          if (progressText) progressText.textContent = '100% • Stream Download Finished!';
          if (speedText) speedText.textContent = 'Saved to Storage';
          if (actions) actions.classList.remove('hidden');
          if (cancelBtn) cancelBtn.classList.add('hidden');

          showToast('Stream download complete! File ready.', 'success', 'fa-circle-check');
          eventSource.close();
          activeEventSources.delete(downloadId);
          loadHistory();

          // Auto-download trigger to browser
          const autoLink = document.createElement('a');
          autoLink.href = `/api/file/${downloadId}`;
          autoLink.download = data.outputFile || 'video.mp4';
          document.body.appendChild(autoLink);
          autoLink.click();
          autoLink.remove();
        } else if (data.status === 'cancelled') {
          if (badge) {
            badge.textContent = 'Cancelled';
            badge.className = 'status-pill cancelled';
          }
          if (bar) {
            bar.style.width = '100%';
            bar.className = 'progress-flow-fill cancelled';
          }
          if (progressText) progressText.textContent = 'Download cancelled';
          if (speedText) speedText.textContent = 'Stopped';
          if (cancelBtn) cancelBtn.classList.add('hidden');
          eventSource.close();
          activeEventSources.delete(downloadId);
        } else if (data.status === 'error') {
          if (badge) {
            const isIspBlock = data.error && (data.error.includes('ISP') || data.error.includes('10054') || data.error.includes('DNS filter'));
            badge.textContent = isIspBlock ? 'Blocked by ISP' : 'Extraction Failed';
            badge.style.background = 'rgba(239, 68, 68, 0.12)';
            badge.style.color = 'var(--accent-coral)';
          }
          if (cancelBtn) cancelBtn.classList.add('hidden');
          if (progressText) progressText.textContent = data.error || 'Download failed.';
          if (speedText) speedText.textContent = data.error?.includes('404') ? 'Stream missing on host' : 'Try Direct Browser Stream';
          
          if (actions && currentVideoData?.videoFormats?.[0]?.directUrl) {
            const streamUrl = currentVideoData.videoFormats[0].directUrl;
            const safeTitle = (currentVideoData.title || 'video').replace(/[/\\?%*:|"<>]/g, '_');
            actions.innerHTML = `
              <a href="${escapeAttr(streamUrl)}" download="${escapeAttr(safeTitle)}.mp4" target="_blank" rel="noopener noreferrer" class="save-file-cta">
                <i class="fa-solid fa-cloud-arrow-down"></i>
                <span>Direct Browser Download</span>
              </a>
            `;
            actions.classList.remove('hidden');
          }

          eventSource.close();
          activeEventSources.delete(downloadId);
        }
      } catch (e) {
        console.error('SSE Progress Parsing Error:', e);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      activeEventSources.delete(downloadId);
    };
  }

  // ══════════════════════════════════════════════════════════════
  // 8. DOWNLOAD HISTORY
  // ══════════════════════════════════════════════════════════════
  async function loadHistory() {
    try {
      const res = await fetch('/api/history');
      const json = await res.json();
      if (json.ok && json.history) {
        if (historyCount) historyCount.textContent = json.history.length;
        renderHistoryList(json.history);
      }
    } catch (e) {}
  }

  function renderHistoryList(items) {
    if (!historyList) return;
    historyList.innerHTML = '';
    if (items.length === 0) {
      historyList.innerHTML = `
        <div class="empty-history-placeholder">
          <i class="fa-solid fa-cloud-arrow-down"></i>
          <p>No downloads recorded yet. Paste a link above to start!</p>
        </div>
      `;
      return;
    }

    items.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'history-entry-card';
      const isAudio = (item.filename || '').endsWith('.mp3');
      const safeName = escapeHtml(item.cleanName || item.filename || 'media');
      const safeSize = escapeHtml(item.sizeFormatted || '0 B');
      const safeUrl = escapeAttr(item.downloadUrl || '#');

      el.innerHTML = `
        <div class="entry-text-info">
          <h5><i class="fa-solid ${isAudio ? 'fa-music' : 'fa-film'}"></i> ${safeName}</h5>
          <p>${safeSize} • ${new Date(item.createdAt).toLocaleTimeString()}</p>
        </div>
        <a href="${safeUrl}" class="entry-save-btn" download>
          <i class="fa-solid fa-download"></i>
          <span>Save</span>
        </a>
      `;
      historyList.appendChild(el);
    });
  }

  // ─── History Drawer Slide-Over ───
  function openHistoryDrawer() {
    loadHistory();
    if (historyDrawer) {
      historyDrawer.classList.remove('hidden');
      historyDrawer.classList.remove('drawer-closing');
    }
  }

  function closeHistoryDrawer() {
    if (historyDrawer) {
      historyDrawer.classList.add('drawer-closing');
      setTimeout(() => {
        historyDrawer.classList.add('hidden');
        historyDrawer.classList.remove('drawer-closing');
      }, 240);
    }
  }

  if (toggleHistoryBtn) toggleHistoryBtn.addEventListener('click', openHistoryDrawer);
  if (closeHistoryBtn) closeHistoryBtn.addEventListener('click', closeHistoryDrawer);
  if (drawerOverlay) drawerOverlay.addEventListener('click', closeHistoryDrawer);

  // ─── Open Folder Storage Handlers ───
  async function openDownloadsFolder() {
    const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    if (!isLocal) {
      showToast('Your video downloads are saved directly into your device\'s browser downloads folder.', 'info', 'fa-folder-open');
      return;
    }
    try {
      const res = await fetch('/api/open-folder', { method: 'POST' });
      const json = await res.json();
      if (json.ok) {
        showToast('Opened storage folder in file manager', 'success', 'fa-folder-open');
      }
    } catch (e) {
      showToast('Could not open storage folder automatically.', 'error', 'fa-triangle-exclamation');
    }
  }

  if (openFolderBtn) openFolderBtn.addEventListener('click', openDownloadsFolder);
  if (openFolderDrawerBtn) openFolderDrawerBtn.addEventListener('click', openDownloadsFolder);

  // Initial Load
  loadHistory();
});
