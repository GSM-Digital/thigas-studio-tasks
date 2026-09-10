"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: { readonly transcript: string };
}

interface SpeechRecognitionEventLike {
  readonly results: {
    readonly length: number;
    readonly [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorLike {
  readonly error: string;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

const subscribeToSpeechSupport = () => () => undefined;
const getSpeechSupport = () => Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition);
const getServerSpeechSupport = () => false;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

function errorMessage(code: string): string | null {
  switch (code) {
    case "aborted":
      return null;
    case "not-allowed":
    case "service-not-allowed":
      return "Permita o acesso ao microfone para usar o ditado.";
    case "no-speech":
      return "Não detectei nenhuma fala. Tente novamente.";
    case "audio-capture":
      return "Nenhum microfone disponível foi encontrado.";
    case "network":
      return "O reconhecimento de voz está sem conexão. Tente novamente.";
    default:
      return "Não foi possível reconhecer a fala. Tente novamente.";
  }
}

export function useSpeechDictation({
  value,
  onChange,
  language = "pt-BR",
  maxLength = 800,
}: {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  maxLength?: number;
}) {
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const baseValueRef = useRef("");
  const listeningRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const supported = useSyncExternalStore(subscribeToSpeechSupport, getSpeechSupport, getServerSpeechSupport);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) return;

    const recognition = new Recognition();
    recognition.lang = language;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      listeningRef.current = true;
      setListening(true);
      setError(null);
    };
    recognition.onend = () => {
      listeningRef.current = false;
      setListening(false);
    };
    recognition.onerror = (event) => {
      const message = errorMessage(event.error);
      if (message) setError(message);
      listeningRef.current = false;
      setListening(false);
    };
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index]?.[0]?.transcript ?? "";
      }
      const prefix = baseValueRef.current.trimEnd();
      const spoken = transcript.trim();
      const nextValue = prefix && spoken ? `${prefix} ${spoken}` : prefix || spoken;
      onChangeRef.current(nextValue.slice(0, maxLength));
    };

    recognitionRef.current = recognition;
    return () => {
      recognition.onstart = null;
      recognition.onend = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.abort();
      recognitionRef.current = null;
    };
  }, [language, maxLength]);

  const toggle = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      setError("O ditado não é compatível com este navegador.");
      return;
    }
    if (listeningRef.current) {
      recognition.stop();
      return;
    }

    baseValueRef.current = value;
    setError(null);
    try {
      recognition.start();
    } catch {
      setError("Não foi possível iniciar o microfone. Tente novamente.");
    }
  }, [value]);

  const cancel = useCallback(() => {
    recognitionRef.current?.abort();
    listeningRef.current = false;
    setListening(false);
  }, []);

  return { supported, listening, error, toggle, cancel };
}
