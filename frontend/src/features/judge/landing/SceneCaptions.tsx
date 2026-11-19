import { captionBody, type Caption, type Captions } from "./landing-captions";

/*
 * The pinned forecast scene's three captions, drawn from the data of landing-captions.ts, and the same three as a plain-text summary for screen
 * readers. Markup only (no hooks, no browser): the stage (a client component) draws the captions with the hour the scroll is at, and the server
 * writes the summary into the first HTML with the three rest hours. Both read their words from `captionsAt`, so they cannot differ.
 */

function Lines({ caption }: { readonly caption: Caption }) {
  return (
    <>
      <p className="eb">{caption.eyebrow}</p>
      <p className="big">
        <b className="n">{caption.value}</b>
        {caption.unit === "" ? null : <span className="un">{caption.unit}</span>}
      </p>
      <p className="sen">{caption.sentence}</p>
      <p className="sen2">{caption.detail}</p>
    </>
  );
}

/** The three captions in the stage's text panel (CSS shows the one for the step the scroll is at). */
export function SceneCaptions({ captions }: { readonly captions: Captions }) {
  return (
    <>
      <div className="s s1">
        <Lines caption={captions.cells} />
      </div>
      <div className="s s2">
        <Lines caption={captions.hottest} />
      </div>
      <div className="s s3">
        <Lines caption={captions.station} />
      </div>
    </>
  );
}

/**
 * The scene's three facts as text that is always there, visually hidden (a screen reader gets them without the map, the scroll or WebGL): a list named
 * `label`, one item per caption with its small line and then what the big number and the sentences say.
 */
export function SceneSummary({ label, captions }: { readonly label: string; readonly captions: readonly Caption[] }) {
  return (
    <ul className="sr-only" aria-label={label} data-scene-summary="">
      {captions.map((caption, i) => (
        <li key={i}>
          <p>{caption.eyebrow}</p>
          <p>{captionBody(caption)}</p>
        </li>
      ))}
    </ul>
  );
}
