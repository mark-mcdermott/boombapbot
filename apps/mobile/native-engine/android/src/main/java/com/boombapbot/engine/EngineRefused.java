package com.boombapbot.engine;

/** What the engine refused, or why something the page sent is not a command, in words. */
public final class EngineRefused extends Exception {

    public EngineRefused(String message) {
        super(message);
    }
}
