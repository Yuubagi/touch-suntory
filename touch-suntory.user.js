// ==UserScript==
// @name         Touch! SUNTORY 自動起動・認証更新・JAN登録
// @namespace    local.touch-suntory
// @author       Yuunagi
// @version      2.4.0
// @description  Touch! SUNTORYのブラウザ起動・期限切れ認証の更新・JAN登録を補助します。
// @homepageURL  https://github.com/Yuubagi/touch-suntory
// @supportURL   https://github.com/Yuubagi/touch-suntory/issues
// @downloadURL  https://raw.githubusercontent.com/Yuubagi/touch-suntory/main/touch-suntory.user.js
// @updateURL    https://raw.githubusercontent.com/Yuubagi/touch-suntory/main/touch-suntory.user.js
// @match        https://liff.line.me/*
// @match        https://miniapp.line.me/*
// @match        https://d1gzxq2us7z70o.cloudfront.net/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==

(async () => {
  "use strict";
  if (window.top !== window.self) return;

  const HOST = "d1gzxq2us7z70o.cloudfront.net";
  const TOKEN_KEY = "LIFF_STORE:2001557247-8jxBGrLn:IDToken";
  const RETRY_KEY = "touch-auth-refresh:lastAttempt";
  const API =
    "https://b66iemzlj7.execute-api.ap-northeast-1.amazonaws.com" +
    "/prod/user/v1/user/closed_cp_point";

  const JANS = [
    "4901777351707",
    "4901777411760",
    "4901777427471",
    "4901777044852",
    "4901777206762"
  ];

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  // 案内画面を隠し、「ブラウザで開く」へ自動移動
  if (location.hostname !== HOST) {
    let finished = false;
    let maskReleased = false;

    const mask = document.createElement("style");
    mask.textContent = "html { visibility:hidden !important; }";

    function installMask() {
      if (
        !maskReleased &&
        !mask.isConnected &&
        document.documentElement
      ) {
        document.documentElement.append(mask);
      }
    }

    function releaseMask() {
      maskReleased = true;
      mask.remove();
    }

    function check() {
      if (finished) return;
      installMask();

      const link = document.querySelector("#linkOpenInBrowserLink");
      if (!link) return;

      let url;
      try {
        url = new URL(link.href, location.href);
      } catch {
        return;
      }

      if (url.protocol !== "https:" || url.hostname !== HOST) return;

      finished = true;
      observer.disconnect();

      try {
        location.replace(url.href);
      } catch {
        releaseMask();
      }
    }

    const observer = new MutationObserver(check);
    observer.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href"]
    });

    // 自動移動できなければ画面を戻す
    setTimeout(releaseMask, 5000);

    setTimeout(() => {
      finished = true;
      observer.disconnect();
      releaseMask();
    }, 30000);

    check();
    return;
  }

  if (window.__touchJanRegistrationInstalled) return;
  window.__touchJanRegistrationInstalled = true;

  // document-startではbodyがない場合がある
  if (!document.body) {
    await new Promise(resolve => {
      const observer = new MutationObserver(() => {
        if (document.body) {
          observer.disconnect();
          resolve();
        }
      });

      observer.observe(document, {
        childList: true,
        subtree: true
      });
    });
  }

  function getToken() {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;

    let value = raw;
    try {
      value = JSON.parse(raw);
    } catch {}

    return typeof value === "string" ? value : null;
  }

  function expiration(token) {
    try {
      const part = token.split(".")[1]
        .replace(/-/g, "+")
        .replace(/_/g, "/");

      const payload = JSON.parse(
        atob(part.padEnd(Math.ceil(part.length / 4) * 4, "="))
      );

      return typeof payload.exp === "number"
        ? payload.exp * 1000
        : null;
    } catch {
      return null;
    }
  }

  function getHs() {
    const url = new URL(location.href);
    const state = url.searchParams.get("liff.state") || "";

    return url.searchParams.get("hs") ||
      new URLSearchParams(
        state.startsWith("?") ? state.slice(1) : state
      ).get("hs");
  }

  // 結果表示用トースト
  const toast = document.createElement("div");
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.style.cssText = `
    position:fixed;
    left:50%;
    bottom:calc(24px + env(safe-area-inset-bottom));
    transform:translateX(-50%);
    width:max-content;
    max-width:calc(100vw - 40px);
    box-sizing:border-box;
    padding:11px 16px;
    border-radius:12px;
    background:rgba(30,30,30,.94);
    color:#fff;
    font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;
    text-align:center;
    white-space:pre-line;
    overflow-wrap:anywhere;
    box-shadow:0 3px 16px #0003;
    z-index:2147483647;
    pointer-events:none;
    opacity:0;
    transition:opacity .2s;
  `;
  document.body.append(toast);

  let toastTimer;

  function notify(message, duration = 4000) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.style.opacity = "1";

    toastTimer = setTimeout(() => {
      toast.style.opacity = "0";
    }, duration);
  }

  // 元のスキャンボタンを置き換える
  const button = document.createElement("button");
  button.id = "touch-jan-button";
  button.type = "button";

  const label = document.createElement("p");
  label.textContent = `自動登録`;
  button.append(label);

  function mountButton() {
    const original = Array.from(
      document.querySelectorAll(
        'button img[src*="header_barcode_scanner"]'
      )
    )
      .map(image => image.closest("button"))
      .find(element => element !== button);

    if (!original) return;

    button.className = original.className;
    button.style.cssText = original.style.cssText;

    label.className =
      original.querySelector("p")?.className || "";

    const image = original.querySelector("img");
    if (image && !button.querySelector("img")) {
      button.prepend(image.cloneNode(true));
    }

    original.replaceWith(button);
  }

  const mountObserver = new MutationObserver(mountButton);
  mountObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
  mountButton();

  button.addEventListener("click", event => {
    event.stopPropagation();
  });

  let busy = false;
  let stopped = false;
  let refreshing = false;

  // 期限切れの場合だけ認証更新
  async function refreshIfExpired() {
    if (busy || refreshing) return;

    const token = getToken();
    const exp = token ? expiration(token) : null;
    if (!token || exp === null || Date.now() < exp) return;

    const last = Number(sessionStorage.getItem(RETRY_KEY)) || 0;

    if (Date.now() - last < 120000) {
      notify("再ログインを確認してください。");
      return;
    }

    // ページ自身による認証更新とLIFF初期化を待つ
    for (let i = 0; i < 80; i++) {
      if (busy) return;

      const current = getToken();
      const currentExp = current ? expiration(current) : null;

      if (!current || currentExp === null || Date.now() < currentExp) {
        return;
      }

      const sdk = window.liff;

      if (
        sdk?.id &&
        typeof sdk.logout === "function" &&
        typeof sdk.isInClient === "function"
      ) {
        if (sdk.isInClient()) {
          notify("ミニアプリを開き直してください。");
          return;
        }

        refreshing = true;
        button.disabled = true;
        label.textContent = "認証更新中";
        notify("認証を更新しています…");

        try {
          sessionStorage.setItem(RETRY_KEY, String(Date.now()));
          sdk.logout();
          location.reload();
        } catch {
          refreshing = false;
          button.disabled = false;
          label.textContent = `自動登録`;
          notify("認証更新に失敗しました。");
        }

        return;
      }

      await sleep(250);
    }

    notify("再ログインしてください。");
  }

  button.onclick = async () => {
    // 実行中の再クリックで残りの送信を停止
    if (busy) {
      stopped = true;
      button.disabled = true;
      label.textContent = "停止中";
      notify("現在の通信が終わり次第、停止します。");
      return;
    }

    if (refreshing) return;

    let token;
    let exp;
    let hs;

    try {
      token = getToken();
      exp = token ? expiration(token) : null;
      hs = getHs();
    } catch {
      notify("認証情報を読み取れません。");
      return;
    }

    if (!token || exp === null || Date.now() >= exp) {
      notify("認証切れです。再ログインしてください。");

      try {
        await refreshIfExpired();
      } catch {
        notify("認証更新に失敗しました。");
      }

      return;
    }

    if (!hs) {
      notify("hsがありません。\n元の入口から開き直してください。");
      return;
    }

    busy = true;
    stopped = false;
    button.disabled = false;

    let success = 0;
    let used = 0;
    let reason = "";

    try {
      for (const [index, jan] of JANS.entries()) {
        if (stopped) {
          reason = "停止しました。";
          break;
        }

        if (getToken() !== token || getHs() !== hs) {
          reason = "認証情報が変わったため停止しました。";
          break;
        }

        if (Date.now() >= exp) {
          reason = "認証の有効期限が切れました。";
          break;
        }

        label.textContent = `停止 ${index + 1}/${JANS.length}`;
        notify(`${index + 1}/${JANS.length}件目を登録中…`);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);

        let response;
        let text;

        try {
          response = await fetch(API, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": token
            },
            body: JSON.stringify({ jan, hs }),
            signal: controller.signal
          });

          text = await response.text();
        } catch {
          reason = "通信結果が不明です。再送せず停止しました。";
          break;
        } finally {
          clearTimeout(timer);
        }

        let data = {};
        try {
          data = JSON.parse(text);
        } catch {}

        const name = data?.name;

        if (response.ok) {
          success++;
          continue;
        }

        if (name === "SameJanInOneDay") {
          used++;
          continue;
        }

        const messages = {
          Forbidden: "対象商品・登録条件を確認してください。",
          DailyAcquisitionLimitExceeded: "本日のポイント獲得上限です。",
          TimeLimitExceeded: "時間切れです。元の入口から開き直してください。",
          BadRequest: "送信内容が正しくありません。"
        };

        reason = messages[name] ||
          (response.status === 401
            ? "認証エラーです。再ログインしてください。"
            : response.status === 429
              ? "送信回数が制限されています。"
              : `エラー：HTTP ${response.status}`);

        break;
      }
    } catch {
      reason = "処理に失敗したため停止しました。";
    } finally {
      if (stopped && !reason) reason = "停止しました。";

      const result = `成功 ${success}件 ／ 本日登録済み ${used}件`;

      notify(
        reason ? `${reason}\n${result}` : `登録完了\n${result}`,
        7000
      );

      busy = false;
      button.disabled = false;
      label.textContent = `自動登録`;
    }
  };

  refreshIfExpired().catch(() => {
    notify("認証更新に失敗しました。");
  });
})();