"use client";

import { useEffect, useRef, useState } from "react";
import { parseYoutubeId, youtubeEmbedSrc } from "./video-config";

/*
 * The landing's video as a click-to-load facade (redesign S8): the ONLY client code of that slice, and the only place the page can reach a
 * third party. Until the Play button is pressed the page loads nothing from YouTube: no iframe, no thumbnail (the poster is our own panel,
 * drawn from our tokens, never `i.ytimg.com`), no script. The press replaces the panel with the privacy-enhanced embed
 * (youtube-nocookie.com, captions on, no related videos) at the same 16:9 box, so nothing moves, and focus goes into the player.
 * There is never autoplay on load: `autoplay=1` is in the URL only because the iframe is created by the press.
 *
 * The words come in as props from the server wrapper (LandingVideo.tsx), already in the page's language: this file reads no message,
 * so the page does not ship a client catalogue for it. An id that is not a YouTube id renders nothing (the wrapper never passes one).
 */

export interface VideoEmbedProps {
  readonly youtubeId: string;
  /** The video's title: the poster's caption and the iframe's `title` (what a screen reader announces the frame as). */
  readonly title: string;
  readonly playLabel: string;
  /** The line under the panel: nothing is loaded from YouTube until Play is pressed. */
  readonly notLoaded: string;
}

export function VideoEmbed({ youtubeId, title, playLabel, notLoaded }: VideoEmbedProps) {
  const id = parseYoutubeId(youtubeId);
  const [playing, setPlaying] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  // The button is gone once it is pressed: focus goes to the player, so a keyboard reader is not dropped at the top of the page.
  useEffect(() => {
    if (playing) frame.current?.focus();
  }, [playing]);

  if (id === null) return null;

  return (
    <div data-video-embed="" className="vidbox">
      <div data-video-panel={playing ? "playing" : "poster"} className="vid">
        {playing ? (
          <iframe
            ref={frame}
            src={youtubeEmbedSrc(id)}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="vid-frame"
          />
        ) : (
          <div className="vid-poster">
            <p>{title}</p>
            <button
              type="button"
              onClick={() => {
                setPlaying(true);
              }}
              className="btn"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20" className="vid-icon">
                <path d="M7 4.5 19 12 7 19.5Z" fill="currentColor" />
              </svg>
              {playLabel}
            </button>
          </div>
        )}
      </div>
      <p className="k">{notLoaded}</p>
    </div>
  );
}
