import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Voice for the chat: dictation (speech-to-text) and read-aloud (text-to-speech),
 * both built on the browser's Web Speech API — no backend, no cost.
 *
 * Dictation uses SpeechRecognition (Chrome / Safari / Android over HTTPS; not
 * Firefox — `supported` is false there so the caller can hide the mic).
 * Read-aloud uses speechSynthesis (effectively universal). Everything is guarded
 * for SSR and feature-detected so it's safe to render server-side.
 */

interface UseVoiceOpts {
  lang?: string;
  /** Called as the user speaks; isFinal flips true on the settled transcript. */
  onTranscript?: (text: string, isFinal: boolean) => void;
}

export function useVoice(opts: UseVoiceOpts = {}) {
  const { lang = 'en-NZ', onTranscript } = opts;

  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakEnabled, setSpeakEnabled] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const recognitionRef = useRef<any>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  // -- Set up speech recognition (client-only) --
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SR) {
      setSupported(false);
      return;
    }
    setSupported(true);

    const rec = new SR();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;

    rec.onresult = (e: any) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += chunk;
        else interim += chunk;
      }
      if (final) onTranscriptRef.current?.(final.trim(), true);
      else if (interim) onTranscriptRef.current?.(interim.trim(), false);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);

    recognitionRef.current = rec;
    return () => {
      try {
        rec.abort();
      } catch {
        /* noop */
      }
    };
  }, [lang]);

  const startListening = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      rec.start();
      setListening(true);
    } catch {
      /* already started */
    }
  }, []);

  const stopListening = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* noop */
      }
    }
    setListening(false);
  }, []);

  // -- Read-aloud --
  const speak = useCallback(
    (text: string) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) return;
      const clean = stripMarkdown(text);
      if (!clean) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = lang;
      u.rate = 1.0;
      u.pitch = 1.0;
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    },
    [lang]
  );

  const stopSpeaking = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  return {
    supported,
    listening,
    startListening,
    stopListening,
    speakEnabled,
    setSpeakEnabled,
    speaking,
    speak,
    stopSpeaking,
  };
}

/** Flatten markdown so the reader doesn't speak asterisks, backticks, hashes, links. */
function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, '. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
}
