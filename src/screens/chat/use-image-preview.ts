import React from 'react'
import type { ChannelUi } from '../../adapter/channel/ui-policy.js'
import type { ChatOverlay, ChatOverlayAction } from '../chatOverlay.js'
import type { TranscriptImage } from '../../dsh-adapter/channel.js'

/** Stable identity for a peek-suppression key: attachment id + token title. */
export function peekKey(image: TranscriptImage, title: string | undefined): string {
  return `${image.id}:${title ?? ''}`
}

export interface ImagePreviewArgs {
  channel: ChannelUi
  overlay: ChatOverlay
  dispatchOverlay: (action: ChatOverlayAction) => void
  /** A questionnaire/approval/plugin dialog pending: previews close under it. */
  previewBlocked: boolean
  /** Composer controller, for the caret-peek gallery (staged [Image #N]). */
  promptControllerRef: React.RefObject<{ previewImages?: () => readonly { image: TranscriptImage; title?: string }[] } | null>
}

/**
 * The image preview family: the modal gallery overlay (composer tokens and
 * transcript thumbnails), the binding-generation guard, and the caret-driven
 * peek card. Extracted verbatim from Chat.
 */
export function useImagePreview({ channel, overlay, dispatchOverlay, previewBlocked, promptControllerRef }: ImagePreviewArgs) {
  /** Shared open path for the modal image preview: composer `[Image #N]`
   *  tokens and transcript thumbnails both land here. */
  const openImagePreview = React.useCallback((image: TranscriptImage, title?: string): void => {
    // Snapshot only metadata/facades on an explicit open, not on every streamed
    // token. Unvisited attachments stay lazy and duplicate image occurrences stay distinct.
    const gallery: { image: TranscriptImage; title?: string }[] = channel.rows.flatMap(row => (row.images ?? []).map(image => ({ image })))
    let index = gallery.findIndex(entry => entry.image === image)
    if (index < 0) { index = gallery.length; gallery.push({ image, title }) }
    dispatchOverlay({
      type: 'open',
      overlay: { kind: 'image-preview', image, gallery, index, ...(title === undefined ? {} : { title }) },
    })
  }, [channel])
  // Agent-binding generation is monotonic across every agent replacement
  // and bumps before the replacement emit, closing the ABA hole where a
  // resumed session reuses the same id. Partial test/embed channels fall
  // back to staged-image generation.
  const previewBindingGeneration = channel.agentBindingGeneration
    ?? channel.stagedImageGeneration?.()
    ?? 0
  const previewGenerationRef = React.useRef(previewBindingGeneration)
  const imagePreviewOwned = previewGenerationRef.current === previewBindingGeneration
  React.useEffect(() => {
    if (previewGenerationRef.current === previewBindingGeneration) return
    previewGenerationRef.current = previewBindingGeneration
    dispatchOverlay({ type: 'close-if', kind: 'image-preview' })
  }, [previewBindingGeneration])
  // A questionnaire/approval/plugin dialog owns the keyboard while pending
  // (their guard runs BEFORE the overlay key chain), so a preview left open
  // underneath would be visually on top yet key-dead. Close it instead.
  React.useEffect(() => {
    if (
      overlay.kind === 'image-preview' &&
      previewBlocked
    ) {
      dispatchOverlay({ type: 'close-if', kind: 'image-preview' })
    }
  }, [overlay.kind, previewBlocked])
  // Caret-driven preview (Grok Build's chip peek): while the composer caret
  // sits on a staged `[Image #N]` — at its start, the token inverted — the
  // same card shows over the transcript, and it goes away when the caret
  // leaves (the cell just after the token is not "on" it). It is
  // derived state, not an overlay: the prompt keeps the keyboard, so ←/→
  // walk from image to image with the card following. Esc (or a click
  // outside the card) dismisses it for THIS token until the caret leaves and
  // comes back; a click on the token always shows it again.
  const [caretPreview, setCaretPreview] = React.useState<
    { image: TranscriptImage; title?: string } | null
  >(null)
  const [peekSuppressed, setPeekSuppressed] = React.useState<string | null>(null)
  const handleCaretImage = React.useCallback((
    image: TranscriptImage | undefined,
    title: string | undefined,
    reason: 'caret' | 'click',
  ): void => {
    if (image === undefined) {
      setCaretPreview(null)
      setPeekSuppressed(null)
      return
    }
    setCaretPreview({ image, ...(title === undefined ? {} : { title }) })
    const key = peekKey(image, title)
    setPeekSuppressed(current => reason === 'click' || current !== key ? null : current)
  }, [])
  const peekPreview =
    !previewBlocked && overlay.kind === 'none' && caretPreview !== null
      && peekSuppressed !== peekKey(caretPreview.image, caretPreview.title)
      ? caretPreview
      : null
  /** Esc / click-outside on the peek: dismissed for this token until the
   *  caret leaves it. PromptInput's Esc arm calls this first — its listener
   *  runs before Chat's and the prompt stays live under a peek. */
  const dismissPeek = (): void => {
    if (peekPreview !== null) setPeekSuppressed(peekKey(peekPreview.image, peekPreview.title))
  }
  /** The card on screen, if any: the modal overlay first, else the peek. */
  const activePreview: { image: TranscriptImage; title?: string; peek: boolean } | null =
    !previewBlocked && overlay.kind === 'image-preview'
      ? { image: overlay.image, ...(overlay.title === undefined ? {} : { title: overlay.title }), peek: false }
      : peekPreview !== null
        ? { ...peekPreview, peek: true }
        : null
  const previewGallery = activePreview === null ? [] : activePreview.peek
    ? promptControllerRef.current?.previewImages?.() ?? [activePreview]
    : overlay.kind === 'image-preview' ? overlay.gallery ?? [activePreview] : []
  // Peek entries are rebuilt from the prompt every render: match by
  // attachment id + token title, not facade identity.
  const previewIndex = activePreview?.peek
    ? previewGallery.findIndex(entry => entry.image.id === activePreview.image.id && entry.title === activePreview.title)
    : overlay.kind === 'image-preview' ? overlay.index ?? 0 : -1
  const stepPreview = (delta: 1 | -1): void => {
    if (!activePreview?.peek) { dispatchOverlay({ type: 'image-step', delta }); return }
    const index = previewIndex + delta
    const entry = previewGallery[index]
    if (!entry) return
    // A gallery click promotes the caret peek to a modal without moving or
    // editing the draft. Suppress the original peek so Esc really closes it.
    setPeekSuppressed(peekKey(activePreview.image, activePreview.title))
    dispatchOverlay({ type: 'open', overlay: { kind: 'image-preview', ...entry, gallery: previewGallery, index } })
  }
  return {
    openImagePreview,
    imagePreviewOwned,
    handleCaretImage,
    peekPreview,
    dismissPeek,
    activePreview,
    setPeekSuppressed,
    stepPreview,
    previewGallery,
    previewIndex,
  }
}
