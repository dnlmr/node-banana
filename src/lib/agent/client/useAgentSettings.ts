"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentHarnessId } from "../types";
import { loadAgentSettings, saveAgentSettings, type AgentClientSettings } from "./settings";

export interface UseAgentSettingsResult {
  settings: AgentClientSettings;
  /** `chosen` (default true): the person picked it; false when the panel opened on it by itself. */
  setHarness: (harness: AgentHarnessId, options?: { chosen?: boolean }) => void;
  setModel: (harness: AgentHarnessId, model: string) => void;
  setEffort: (harness: AgentHarnessId, effort: string) => void;
}

/** The persisted harness and per-harness model choice. Client-only (reads localStorage on mount). */
export function useAgentSettings(): UseAgentSettingsResult {
  const [settings, setSettings] = useState<AgentClientSettings>(loadAgentSettings);
  const loaded = useRef(true);

  useEffect(() => {
    // The first run is the value just loaded; only write real changes.
    if (loaded.current) {
      loaded.current = false;
      return;
    }
    saveAgentSettings(settings);
  }, [settings]);

  const setHarness = useCallback((harness: AgentHarnessId, options: { chosen?: boolean } = {}) => {
    const chosen = options.chosen ?? true;
    setSettings((previous) =>
      previous.harness === harness && Boolean(previous.harnessChosen) === (chosen || Boolean(previous.harnessChosen))
        ? previous
        : { ...previous, harness, harnessChosen: chosen || Boolean(previous.harnessChosen) },
    );
  }, []);

  const setModel = useCallback((harness: AgentHarnessId, model: string) => {
    setSettings((previous) =>
      previous.models[harness] === model
        ? previous
        : { ...previous, models: { ...previous.models, [harness]: model } },
    );
  }, []);

  const setEffort = useCallback((harness: AgentHarnessId, effort: string) => {
    setSettings((previous) =>
      previous.efforts[harness] === effort
        ? previous
        : { ...previous, efforts: { ...previous.efforts, [harness]: effort } },
    );
  }, []);

  return { settings, setHarness, setModel, setEffort };
}
