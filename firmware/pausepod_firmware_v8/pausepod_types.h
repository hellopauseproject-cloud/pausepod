#pragma once

#include <Arduino.h>

enum Phase {
  IDLE,
  STATS,
  CHECKING_IN,
  CHECKED_IN,
  AWAITING_LID,
  ACTIVE,
  SHOWING_TIME,
  CHECKOUT_ARMING,
  CHECKOUT_CONFIRM,
  RESPITE,
  ENDED
};

struct TouchPad {
  int           pin;
  bool          state;
  bool          lastRaw;
  unsigned long pressedAtMs;
  unsigned long lastChangeMs;
  const char*   name;
};

struct SessionRecord {
  uint32_t      seq;
  uint32_t      durationMs;
  unsigned long endedAtMillis;
  uint8_t       completed;
};
