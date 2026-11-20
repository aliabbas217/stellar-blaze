import { useTranslations } from "next-intl";
import { LANDING_YOUTUBE_ID, parseYoutubeId } from "./video-config";
import { VideoEmbed } from "./VideoEmbed";

/*
 * The landing's video block, the server half. It reads the one config (landing-video.json, through video-config.ts) and picks:
 *   - no valid id (until the video is published): a 16:9 panel in our own tokens with one sentence, no button and nothing from a third party;
 *   - an id: the click-to-load player (VideoEmbed.tsx), the only code that can reach a third party, and nothing loads from it before Play.
 * `youtubeId` is a prop for the tests only (the page passes nothing); anything that is not a YouTube id counts as no video. The Content-Security-Policy
 * grows `frame-src` for youtube-nocookie.com only while an id is set (csp.ts).
 */
export function LandingVideo({ youtubeId = LANDING_YOUTUBE_ID }: { readonly youtubeId?: string | null }) {
  const t = useTranslations("judge.landing.video");
  const id = parseYoutubeId(youtubeId);
  if (id !== null) return <VideoEmbed youtubeId={id} title={t("title")} playLabel={t("play")} notLoaded={t("notLoaded")} />;
  return (
    <div data-video-embed="" className="vidbox">
      <div data-video-panel="soon" className="vid">
        <p>{t("soon")}</p>
      </div>
    </div>
  );
}
