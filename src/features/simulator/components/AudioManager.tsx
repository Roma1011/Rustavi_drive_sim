import { useEffect, useMemo, useRef, useState } from 'react';
import { MathUtils } from 'three';
import { ASSET_PATHS } from '../../../shared/config/assets';
import { getEngineLoopProfile } from '../lib/engine-audio';
import { useSimulatorStore } from '../state/simulator.store';

const AUDIO_LEVELS = {
  brake: 0.4,
  city: 0.18,
  crash: 0.42,
  drift: 0.34,
  horn: 0.46,
  reverseBeep: 0.22,
} as const;

function createLoopingAudio(src: string, volume: number) {
  const audio = new Audio(src);
  audio.loop = true;
  audio.preload = 'auto';
  audio.muted = false;
  (audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
  audio.volume = volume;
  audio.load();
  return audio;
}

function createEngineLoopAudio(src: string) {
  const audio = createLoopingAudio(src, 0);
  audio.loop = false;
  (
    audio as HTMLAudioElement & {
      mozPreservesPitch?: boolean;
      preservesPitch?: boolean;
      webkitPreservesPitch?: boolean;
    }
  ).mozPreservesPitch = false;
  (
    audio as HTMLAudioElement & {
      mozPreservesPitch?: boolean;
      preservesPitch?: boolean;
      webkitPreservesPitch?: boolean;
    }
  ).preservesPitch = false;
  (
    audio as HTMLAudioElement & {
      mozPreservesPitch?: boolean;
      preservesPitch?: boolean;
      webkitPreservesPitch?: boolean;
    }
  ).webkitPreservesPitch = false;
  return audio;
}

function createOneShotAudio(src: string, volume: number) {
  const audio = new Audio(src);
  audio.preload = 'auto';
  audio.muted = false;
  (audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
  audio.volume = volume;
  audio.load();
  return audio;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(value, 1));
}

function setAudioVolume(audio: HTMLAudioElement, value: number) {
  audio.volume = clamp01(value);
}

async function playIfPossible(audio: HTMLAudioElement) {
  try {
    await audio.play();
    return true;
  } catch {
    return false;
  }
}

export function AudioManager() {
  const ambienceVolume = useSimulatorStore((state) => state.ambienceVolume);
  const debugBlocked = useSimulatorStore((state) => state.debugBlocked);
  const debugInput = useSimulatorStore((state) => state.debugInput);
  const effectsVolume = useSimulatorStore((state) => state.effectsVolume);
  const engineVolume = useSimulatorStore((state) => state.engineVolume);
  const gear = useSimulatorStore((state) => state.gear);
  const isReversing = useSimulatorStore((state) => state.isReversing);
  const isReady = useSimulatorStore((state) => state.isReady);
  const masterVolume = useSimulatorStore((state) => state.masterVolume);
  const rpm = useSimulatorStore((state) => state.rpm);
  const selectedVehicleId = useSimulatorStore((state) => state.selectedVehicleId);
  const shiftIntensity = useSimulatorStore((state) => state.shiftIntensity);
  const speedKph = useSimulatorStore((state) => state.speedKph);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const brakeLockRef = useRef(false);
  const crashLockRef = useRef(false);
  const engineLoopRef = useRef<{
    playbackRate: number;
    rafId: number | null;
    smoothedPlaybackRate: number;
    smoothedTargetVolume: number;
    targetVolume: number;
    usingPrimary: boolean;
  }>({
    playbackRate: 1,
    rafId: null,
    smoothedPlaybackRate: 1,
    smoothedTargetVolume: 0,
    targetVolume: 0,
    usingPrimary: true,
  });
  const longTurnStartRef = useRef<number | null>(null);

  const audio = useMemo(
    () => ({
      brake: createOneShotAudio(ASSET_PATHS.audio.brake, AUDIO_LEVELS.brake),
      city: createLoopingAudio(ASSET_PATHS.audio.city, AUDIO_LEVELS.city),
      crash: createOneShotAudio(ASSET_PATHS.audio.crash, AUDIO_LEVELS.crash),
      drift: createLoopingAudio(ASSET_PATHS.audio.drift, 0),
      enginePrimary: createEngineLoopAudio(getEngineLoopProfile(selectedVehicleId).src),
      engineSecondary: createEngineLoopAudio(getEngineLoopProfile(selectedVehicleId).src),
      horn: createOneShotAudio(ASSET_PATHS.audio.horn, AUDIO_LEVELS.horn),
      reverseBeep: createLoopingAudio(ASSET_PATHS.audio.reverseBeep, AUDIO_LEVELS.reverseBeep),
    }),
    [],
  );

  useEffect(() => {
    const nextEngineSource = getEngineLoopProfile(selectedVehicleId).src;
    const nextEngineUrl = new URL(nextEngineSource, window.location.href).href;

    if (audio.enginePrimary.src !== nextEngineUrl || audio.engineSecondary.src !== nextEngineUrl) {
      audio.enginePrimary.pause();
      audio.engineSecondary.pause();
      audio.enginePrimary.src = nextEngineUrl;
      audio.engineSecondary.src = nextEngineUrl;
      audio.enginePrimary.currentTime = 0;
      audio.engineSecondary.currentTime = 0;
      audio.enginePrimary.volume = 0;
      audio.engineSecondary.volume = 0;
      audio.enginePrimary.load();
      audio.engineSecondary.load();
      engineLoopRef.current.smoothedPlaybackRate = 1;
      engineLoopRef.current.smoothedTargetVolume = 0;
      engineLoopRef.current.usingPrimary = true;
    }

    if (isUnlocked) {
      void playIfPossible(audio.enginePrimary);
    }
  }, [audio, isUnlocked, selectedVehicleId]);

  useEffect(() => {
    const unlockAudio = async () => {
      if (isUnlocked) {
        return;
      }

      const [engineStarted, cityStarted, driftStarted, reverseStarted] = await Promise.all([
        playIfPossible(audio.enginePrimary),
        playIfPossible(audio.city),
        playIfPossible(audio.drift),
        playIfPossible(audio.reverseBeep),
      ]);

      if (driftStarted) {
        setAudioVolume(audio.drift, 0);
      }

      if (reverseStarted) {
        setAudioVolume(audio.reverseBeep, 0);
      }

      if (engineStarted || cityStarted || driftStarted || reverseStarted) {
        setIsUnlocked(true);
      }
    };

    const handleDriveInputUnlock = async (event: KeyboardEvent) => {
      const code = `${event.code || event.key}`.toLowerCase();
      const isDriveKey =
        code === 'arrowup' ||
        code === 'arrowdown' ||
        code === 'keyw' ||
        code === 'keys' ||
        code === 'w' ||
        code === 's';

      if (!isDriveKey) {
        return;
      }

      await unlockAudio();
    };

    const handleHorn = async (event: KeyboardEvent) => {
      const code = `${event.code || event.key}`.toLowerCase();

      if (code !== 'keyf' && code !== 'f') {
        return;
      }

      event.preventDefault();

      if (!isUnlocked) {
        await unlockAudio();
      }

      try {
        audio.horn.currentTime = 0;
        await audio.horn.play();
      } catch {
        // Ignore blocked playback.
      }
    };

    window.addEventListener('pointerdown', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio);
    window.addEventListener('keydown', handleDriveInputUnlock);
    window.addEventListener('keydown', handleHorn);

    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('keydown', handleDriveInputUnlock);
      window.removeEventListener('keydown', handleHorn);
    };
  }, [audio, isUnlocked]);

  useEffect(() => {
    const profile = getEngineLoopProfile(selectedVehicleId);
    const rpmRatio = Math.max(0, Math.min((rpm - 850) / 5950, 1));
    const speedRatio = Math.max(0, Math.min(speedKph / 210, 1));
    const throttleRatio = Math.abs(debugInput.throttle);
    const shiftRateDrop = 1 - shiftIntensity * 0.12;
    const shiftVolumeDuck = 1 - shiftIntensity * 0.26;
    const playbackRate =
      (profile.idleRate + (profile.maxRate - profile.idleRate) * rpmRatio) * shiftRateDrop;
    const targetVolume =
      Math.min(
        profile.idleGain + throttleRatio * profile.throttleGain + speedRatio * profile.speedGain,
        0.96,
      ) *
      masterVolume *
      engineVolume *
      shiftVolumeDuck;

    engineLoopRef.current.playbackRate = playbackRate;
    engineLoopRef.current.targetVolume =
      !isUnlocked || !isReady ? 0 : gear === 'R' ? targetVolume * profile.reverseGain : targetVolume;
  }, [
    debugInput.throttle,
    engineVolume,
    gear,
    isReady,
    isUnlocked,
    masterVolume,
    rpm,
    selectedVehicleId,
    shiftIntensity,
    speedKph,
  ]);

  useEffect(() => {
    if (!isUnlocked || !isReady) {
      audio.enginePrimary.pause();
      audio.engineSecondary.pause();
      audio.enginePrimary.currentTime = 0;
      audio.engineSecondary.currentTime = 0;
      audio.enginePrimary.volume = 0;
      audio.engineSecondary.volume = 0;
      engineLoopRef.current.smoothedPlaybackRate = 1;
      engineLoopRef.current.smoothedTargetVolume = 0;
      engineLoopRef.current.usingPrimary = true;
      return;
    }

    const tick = () => {
      const active = engineLoopRef.current.usingPrimary ? audio.enginePrimary : audio.engineSecondary;
      const standby = engineLoopRef.current.usingPrimary ? audio.engineSecondary : audio.enginePrimary;
      engineLoopRef.current.smoothedPlaybackRate = active.paused
        ? engineLoopRef.current.playbackRate
        : MathUtils.damp(
            engineLoopRef.current.smoothedPlaybackRate,
            engineLoopRef.current.playbackRate,
            10,
            1 / 60,
          );
      engineLoopRef.current.smoothedTargetVolume = active.paused
        ? engineLoopRef.current.targetVolume
        : MathUtils.damp(
            engineLoopRef.current.smoothedTargetVolume,
            engineLoopRef.current.targetVolume,
            12,
            1 / 60,
          );
      const targetVolume = engineLoopRef.current.smoothedTargetVolume;
      const playbackRate = engineLoopRef.current.smoothedPlaybackRate;
      const duration = Number.isFinite(active.duration) ? active.duration : 0;
      const crossfadeWindow = duration > 0 ? Math.min(0.28, duration * 0.2) : 0;

      active.playbackRate = playbackRate;
      standby.playbackRate = playbackRate;

      if (active.paused) {
        active.currentTime = 0;
        void active.play().catch(() => {});
      }

      if (duration > crossfadeWindow && active.currentTime >= duration - crossfadeWindow) {
        if (standby.paused) {
          standby.currentTime = 0;
          standby.volume = 0;
          void standby.play().catch(() => {});
        }

        const blendProgress = clamp01(
          (active.currentTime - (duration - crossfadeWindow)) / Math.max(crossfadeWindow, 0.001),
        );
        setAudioVolume(active, targetVolume * (1 - blendProgress));
        setAudioVolume(standby, targetVolume * blendProgress);

        if (blendProgress >= 0.98) {
          active.pause();
          active.currentTime = 0;
          active.volume = 0;
          setAudioVolume(standby, targetVolume);
          engineLoopRef.current.usingPrimary = !engineLoopRef.current.usingPrimary;
        }
      } else {
        setAudioVolume(active, targetVolume);

        if (!standby.paused) {
          standby.pause();
          standby.currentTime = 0;
        }

        standby.volume = 0;
      }

      engineLoopRef.current.rafId = window.requestAnimationFrame(tick);
    };

    if (engineLoopRef.current.rafId == null) {
      engineLoopRef.current.rafId = window.requestAnimationFrame(tick);
    }

    return () => {
      if (engineLoopRef.current.rafId != null) {
        window.cancelAnimationFrame(engineLoopRef.current.rafId);
        engineLoopRef.current.rafId = null;
      }
    };
  }, [audio, isReady, isUnlocked]);

  useEffect(() => {
    if (!isUnlocked || !isReady) {
      return;
    }

    if (audio.city.paused) {
      void audio.city.play().catch(() => {});
    }

    if (audio.drift.paused) {
      void audio.drift.play().catch(() => {});
    }
  }, [audio, isReady, isUnlocked]);

  useEffect(() => {
    setAudioVolume(audio.city, AUDIO_LEVELS.city * masterVolume * ambienceVolume);
  }, [ambienceVolume, audio, masterVolume]);

  useEffect(() => {
    if (!isUnlocked || !isReady) {
      return;
    }

    const shouldPlayReverseBeep = gear === 'R' || isReversing;
    setAudioVolume(
      audio.reverseBeep,
      shouldPlayReverseBeep ? AUDIO_LEVELS.reverseBeep * masterVolume * effectsVolume : 0,
    );

    if (shouldPlayReverseBeep && audio.reverseBeep.paused) {
      void audio.reverseBeep.play().catch(() => {});
    }

    if (!shouldPlayReverseBeep && !audio.reverseBeep.paused) {
      audio.reverseBeep.pause();
      audio.reverseBeep.currentTime = 0;
    }
  }, [audio, effectsVolume, gear, isReady, isReversing, isUnlocked, masterVolume]);

  useEffect(() => {
    if (!isUnlocked) {
      return;
    }

    const isHardBrake = debugInput.brake && speedKph > 18;

    if (isHardBrake && !brakeLockRef.current) {
      brakeLockRef.current = true;
      setAudioVolume(audio.brake, AUDIO_LEVELS.brake * masterVolume * effectsVolume);
      audio.brake.currentTime = 0;
      void audio.brake.play().catch(() => {});
    }

    if (!debugInput.brake) {
      brakeLockRef.current = false;
    }
  }, [audio, debugInput.brake, effectsVolume, isUnlocked, masterVolume, speedKph]);

  useEffect(() => {
    if (!isUnlocked || !isReady) {
      return;
    }

    const steerAmount = Math.abs(debugInput.steer);
    const driftRatio = Math.min(speedKph / 140, 1);
    const isLongTurnCandidate = speedKph > 100 && steerAmount > 0.2;
    const now = performance.now();

    if (isLongTurnCandidate) {
      longTurnStartRef.current ??= now;
    } else {
      longTurnStartRef.current = null;
    }

    const turnDuration =
      longTurnStartRef.current == null ? 0 : Math.max(0, now - longTurnStartRef.current);
    const sustainedTurnRatio = Math.min(Math.max((turnDuration - 900) / 300, 0), 1);
    const shouldDrift = sustainedTurnRatio > 0;

    setAudioVolume(
      audio.drift,
      shouldDrift
        ? Math.min(
            (0.12 + driftRatio * (0.16 + steerAmount * 0.22)) * sustainedTurnRatio,
            AUDIO_LEVELS.drift,
          ) *
            masterVolume *
            effectsVolume
        : 0,
    );
    audio.drift.playbackRate = shouldDrift ? 0.92 + driftRatio * 0.35 : 0.9;
  }, [audio, debugInput.steer, effectsVolume, isReady, isUnlocked, masterVolume, speedKph]);

  useEffect(() => {
    if (!isUnlocked) {
      return;
    }

    if (debugBlocked && speedKph > 10 && !crashLockRef.current) {
      crashLockRef.current = true;
      setAudioVolume(audio.crash, AUDIO_LEVELS.crash * masterVolume * effectsVolume);
      audio.crash.currentTime = 0;
      void audio.crash.play().catch(() => {});
    }

    if (!debugBlocked) {
      crashLockRef.current = false;
    }
  }, [audio, debugBlocked, effectsVolume, isUnlocked, masterVolume, speedKph]);

  useEffect(() => {
    setAudioVolume(audio.horn, AUDIO_LEVELS.horn * masterVolume * effectsVolume);
  }, [audio, effectsVolume, masterVolume]);

  useEffect(() => {
    return () => {
      audio.brake.pause();
      audio.city.pause();
      audio.crash.pause();
      audio.drift.pause();
      audio.enginePrimary.pause();
      audio.engineSecondary.pause();
      audio.horn.pause();
      audio.reverseBeep.pause();
    };
  }, [audio]);

  return null;
}
