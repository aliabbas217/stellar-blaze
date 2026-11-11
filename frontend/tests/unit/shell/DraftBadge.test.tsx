import { screen } from "@testing-library/react";
import { DraftBadge } from "@/components/shell/DraftBadge";
import enMessages from "../../../messages/en.json";
import hiMessages from "../../../messages/hi.json";
import { renderWithIntl } from "../../utils/intl";

describe("DraftBadge", () => {
  it("shows the badge in the language of a machine-draft file", () => {
    renderWithIntl(<DraftBadge />, { locale: "hi", messages: hiMessages });
    expect(screen.getByText("प्रारूप अनुवाद", { exact: false })).toBeInTheDocument();
  });

  it("is absent in the source language", () => {
    const { container } = renderWithIntl(<DraftBadge />, { locale: "en", messages: enMessages });
    expect(container).toBeEmptyDOMElement();
  });

  it("is absent once a native speaker has reviewed the file", () => {
    const reviewed = { ...hiMessages, _meta: { review_status: "reviewed" } };
    const { container } = renderWithIntl(<DraftBadge />, { locale: "hi", messages: reviewed });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows for any status that is not source or reviewed", () => {
    const unknown = { ...enMessages, _meta: { review_status: "machine-draft" } };
    renderWithIntl(<DraftBadge />, { locale: "en", messages: unknown });
    expect(screen.getByText("Draft translation", { exact: false })).toBeInTheDocument();
  });

  it("tells screen readers why, not only that, the translation is a draft", () => {
    const unknown = { ...enMessages, _meta: { review_status: "machine-draft" } };
    renderWithIntl(<DraftBadge />, { messages: unknown });
    const note = screen.getByText(/machine draft/);
    expect(note).toHaveClass("sr-only");
    // Exactly the message: no punctuation or spacing is added in code (it differs per script).
    expect(note.textContent).toBe(enMessages.shell.draftTranslationNote);
  });

  it("keeps the label and the note in separate paragraphs, so they are read apart", () => {
    const unknown = { ...enMessages, _meta: { review_status: "machine-draft" } };
    renderWithIntl(<DraftBadge />, { messages: unknown });
    const label = screen.getByText(enMessages.shell.draftTranslation);
    const note = screen.getByText(enMessages.shell.draftTranslationNote);
    expect(label.tagName).toBe("P");
    expect(note.tagName).toBe("P");
    expect(label).not.toBe(note);
  });
});
