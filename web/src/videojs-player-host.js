import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { createPlayer, videoFeatures } from "@videojs/react";
import { Video, VideoSkin } from "@videojs/react/video";
import "@videojs/react/video/skin.css";

let root = null;
const Player = createPlayer({ features: videoFeatures });

function getVideoElement(host, currentRef) {
  if (currentRef instanceof HTMLVideoElement) {
    return currentRef;
  }

  const queryVideo = host.querySelector("video");
  if (queryVideo instanceof HTMLVideoElement) {
    return queryVideo;
  }

  return null;
}

function configureVideoElement(videoElement, src, poster) {
  videoElement.crossOrigin = "anonymous";
  videoElement.preload = "auto";
  videoElement.muted = false;
  videoElement.loop = true;
  videoElement.playsInline = true;

  if (poster && !videoElement.poster) {
    videoElement.poster = poster;
  }

  const currentSource = videoElement.currentSrc || videoElement.src;
  if (src && !currentSource) {
    videoElement.src = src;
    videoElement.load();
  }
}

export function changeVideoSource(videoElement, src, poster) {
  if (!videoElement) return null;
  videoElement.pause();
  videoElement.removeAttribute("src");
  videoElement.load();

  if (poster) {
    videoElement.poster = poster;
  }
  videoElement.src = src;
  videoElement.load();

  videoElement.crossOrigin = "anonymous";
  videoElement.playsInline = true;
  videoElement.loop = true;
  videoElement.muted = false;

  const playPromise = videoElement.play();
  if (playPromise) {
    playPromise.catch(() => {});
  }
  return playPromise ?? null;
}

export async function mountHiddenVideoJsPlayer(options = {}) {
  const {
    containerId = "videojs-player-root",
    src,
    poster,
    timeoutMs = 10000,
  } = options;
  const host = document.getElementById(containerId);

  if (!host) {
    throw new Error(`Missing #${containerId} element`);
  }

  if (!root) {
    root = createRoot(host);
  }

  let videoRef = null;
  root.render(
    createElement(
      Player.Provider,
      null,
      createElement(
        VideoSkin,
        null,
        createElement(Video, {
          ref: (element) => {
            videoRef = element;
          },
          src,
          poster,
          preload: "auto",
          autoPlay: false,
          muted: false,
          loop: true,
          playsInline: true,
          controls: true,
          crossOrigin: "anonymous",
        }),
      ),
    ),
  );

  const start = performance.now();

  return await new Promise((resolve, reject) => {
    const check = () => {
      const videoElement = getVideoElement(host, videoRef);

      if (videoElement) {
        configureVideoElement(videoElement, src, poster);
        resolve({
          videoElement,
          getVideoElement: () => getVideoElement(host, videoRef),
        });
        return;
      }

      if (performance.now() - start >= timeoutMs) {
        reject(new Error("Timed out while waiting for Video.js media element"));
        return;
      }

      requestAnimationFrame(check);
    };

    check();
  });
}
