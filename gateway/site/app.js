const language = navigator.languages?.find((value) => value.toLowerCase().startsWith("zh"))
  ?? navigator.language;
const locale = language?.toLowerCase().startsWith("zh") ? "zh" : "en";

const phone = navigator.userAgentData?.mobile
  ?? /(?:Android.+Mobile|iPhone|iPod|Windows Phone|webOS|BlackBerry|Opera Mini|IEMobile)/iu.test(navigator.userAgent);

if (phone) {
  window.location.replace("/app/");
}

document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
document.title = locale === "zh" ? "下载 Fields Windows 版" : "Download Fields for Windows";

for (const element of document.querySelectorAll("[data-en][data-zh]")) {
  element.textContent = element.dataset[locale];
}

const releaseDetail = document.querySelector("#release-detail");

fetch("/desktop/releases/latest.json", {
  cache: "no-store",
  headers: { Accept: "application/json" },
})
  .then((response) => {
    if (!response.ok) throw new Error("manifest unavailable");
    return response.json();
  })
  .then((manifest) => {
    if (!releaseDetail || !/^\d+\.\d+\.\d+$/.test(manifest?.version)) return;
    releaseDetail.textContent = locale === "zh"
      ? `版本 ${manifest.version}，Windows x64`
      : `Version ${manifest.version}, Windows x64`;
  })
  .catch(() => {
    // The stable installer remains available when release metadata is unavailable.
  });
