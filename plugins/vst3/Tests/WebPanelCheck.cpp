// Opens the plugin's web view window with no host, in a real window on the
// desktop, and works the page in it: that it loads from inside the plugin,
// that a control on the page moves the plugin, and that the plugin moves the
// page. macOS only: it turns the system's own run loop while it waits.
//
//   web_panel_check <beat file>

#include "ParameterIds.h"
#include "PluginProcessor.h"
#include "WebPanel/WebPanelEditor.h"

#include <CoreFoundation/CoreFoundation.h>

#include <cmath>
#include <cstdio>
#include <functional>
#include <memory>
#include <string>

namespace {

namespace ids = boombapbot::plugin::ids;

int failures = 0;

void check(bool passed, const std::string& what) {
  if (!passed) ++failures;
  std::printf("%s %s\n", passed ? "ok  " : "FAIL", what.c_str());
}

// Lets the window, the web view and JUCE's own messages run until `done` or the time is up.
bool waitFor(const std::function<bool()>& done, int milliseconds) {
  const juce::uint32 until = juce::Time::getMillisecondCounter() + static_cast<juce::uint32>(milliseconds);
  while (!done() && juce::Time::getMillisecondCounter() < until) CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.01, false);
  return done();
}

void wait(int milliseconds) {
  waitFor([] { return false; }, milliseconds);
}

// Runs a line of JavaScript in the page and waits for what it comes to.
juce::var ask(juce::WebBrowserComponent& browser, const juce::String& script) {
  bool answered = false;
  juce::var answer;
  browser.evaluateJavascript(script, [&](juce::WebBrowserComponent::EvaluationResult result) {
    if (const juce::var* const value = result.getResult()) answer = *value;
    answered = true;
  });
  waitFor([&] { return answered; }, 5000);
  return answer;
}

float parameter(BoombapbotAudioProcessor& plugin, const juce::String& id) {
  return plugin.parameters().getRawParameterValue(id)->load();
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 2) {
    std::fprintf(stderr, "usage: %s <beat file>\n", argv[0]);
    return 2;
  }
  const juce::ScopedJuceInitialiser_GUI juceInitialiser;

  BoombapbotAudioProcessor plugin;
  plugin.setPlayConfigDetails(0, 2, 48000.0, 512);
  plugin.prepareToPlay(48000.0, 512);
  const juce::Result loaded = plugin.loadBeat(
      juce::File::getCurrentWorkingDirectory().getChildFile(juce::String::fromUTF8(argv[1])).loadFileAsString());
  check(loaded.wasOk(), "the plugin holds the fixture beat");

  const juce::uint32 opened = juce::Time::getMillisecondCounter();
  auto* const window = dynamic_cast<BoombapbotWebEditor*>(plugin.createEditorIfNeeded());
  check(window != nullptr, "the plugin's window is the web view");
  if (window == nullptr) return 1;
  window->setOpaque(true);
  window->addToDesktop(juce::ComponentPeer::windowHasTitleBar);
  window->setTopLeftPosition(60, 80);
  window->setVisible(true);
  window->toFront(false);

  const bool ready = waitFor([&] { return window->pageIsReady(); }, 20000);
  const int openTime = static_cast<int>(juce::Time::getMillisecondCounter() - opened);
  check(ready, "the page loads from inside the plugin and says it is up (" + std::to_string(openTime) + " ms)");
  if (ready) {
    juce::WebBrowserComponent& page = window->browser();
    wait(600);

    // What the page shows.
    const int controls = static_cast<int>(ask(page, "document.querySelectorAll('[data-testid]').length"));
    const juce::String panel = ask(page, "document.querySelector('[data-testid=panel]') ? "
                                         "getComputedStyle(document.querySelector('[data-testid=plate]')).backgroundImage "
                                         "+ ' ' + (document.querySelector('[data-testid=plate]').currentSrc || '') : 'none'")
                                   .toString();
    const juce::String art = ask(page, "performance.getEntriesByType('resource').map(r => r.name.split('/').pop())"
                                       ".filter(n => /plate|pointer|patch|webp|png/.test(n)).length + ' pictures, ' + "
                                       "Array.from(document.images).filter(i => !i.complete || i.naturalWidth === 0).length "
                                       "+ ' not drawn, fonts ' + document.fonts.status")
                               .toString();
    check(controls > 40, "the painted panel is there, with its controls (" + std::to_string(controls) + " marked parts)");
    // Being in the page is not being seen: the picture has to be drawn, and to fill the window.
    const juce::String picture = ask(page, "(() => { const p = document.querySelector('[data-testid=plate]'); "
                                           "const r = p.getBoundingClientRect(); return [Math.round(r.width), "
                                           "Math.round(r.height), innerWidth, p.naturalWidth].join(' '); })()")
                                     .toString();
    const juce::StringArray sizes = juce::StringArray::fromTokens(picture, false);
    check(sizes.size() == 4 && sizes[3].getIntValue() > 0 && sizes[0].getIntValue() >= sizes[2].getIntValue() - 2 &&
              std::abs(sizes[0].getIntValue() * 2 - sizes[1].getIntValue() * 3) <= 6,
          "the picture is drawn, fills the window's width and keeps its three-to-two shape (" +
              sizes[0].toStdString() + " x " + sizes[1].toStdString() + " in a window " + sizes[2].toStdString() +
              " wide)");
    std::printf("     its art: %s\n", art.toRawUTF8());
    const juce::String size = ask(page, "innerWidth + ' x ' + innerHeight + ' at ' + devicePixelRatio + 'x'").toString();
    std::printf("     the page is %s; %s\n", size.toRawUTF8(), panel.substring(0, 90).toRawUTF8());

    // The page opened on the plugin's beat.
    const double kickPitch = ask(page, "window.__panel.project().voices.kick.pitch");
    const juce::String name = ask(page, "window.__panel.project().name").toString();
    check(std::abs(kickPitch - 0.35) < 1e-6 && name == "Four patterns fixture",
          "the page opened on the plugin's beat (" + name.toStdString() + ", kick pitch " + std::to_string(kickPitch) + ")");

    // The page to the plugin: a voice chosen, a step key pressed, a knob turned by its keys.
    ask(page, "document.querySelector('[data-testid=pattern-1]').click()");
    ask(page, "document.querySelector('[data-testid=voice-tom]').click()");
    wait(300);
    const bool before = plugin.stepOn(0, 5, 2);
    ask(page, "document.querySelector('[data-testid=step-3]').click()");
    wait(400);
    check(plugin.selectedVoice() == 5 && juce::roundToInt(parameter(plugin, ids::kPattern)) == 0 &&
              plugin.stepOn(0, 5, 2) != before,
          "on the page, choosing pattern 1 and the tom and pressing step key 3 writes that step in the plugin");

    // A voice's key on the page is heard: the press reaches the audio thread.
    juce::AudioBuffer<float> block(2, 512);
    juce::MidiBuffer noNotes;
    float heard = 0.0f;
    for (int count = 0; count < 20; ++count) {
      block.clear();
      plugin.processBlock(block, noNotes);
      heard = juce::jmax(heard, block.getMagnitude(0, 512));
    }
    check(heard > 0.01f, "and the tom's key on the page plays the tom (peak " + std::to_string(heard) + ")");

    const float volumeBefore = parameter(plugin, ids::kVolume);
    ask(page, "(() => { const k = document.querySelector('[data-testid=volume]'); k.focus(); "
              "for (let i = 0; i < 3; i++) k.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true})); })()");
    wait(400);
    const float volumeAfter = parameter(plugin, ids::kVolume);
    check(volumeAfter < volumeBefore - 0.005f,
          "turning the page's volume knob down moves the host's Volume parameter (" + std::to_string(volumeBefore) +
              " to " + std::to_string(volumeAfter) + ")");

    // The plugin to the page: a parameter the host automates, and a step written elsewhere.
    plugin.parameters().getParameter(ids::kSwing)->setValueNotifyingHost(0.8f);
    plugin.parameters().getParameter("tom_pitch")->setValueNotifyingHost(0.9f);
    plugin.setStep(0, 5, 9, true);
    wait(500);
    const double swing = ask(page, "window.__panel.project().swing");
    const double tomPitch = ask(page, "window.__panel.project().voices.tom.pitch");
    const juce::String tomRow = ask(page, "window.__panel.project().patterns[0].steps.tom").toString();
    check(std::abs(swing - 0.8) < 1e-5 && std::abs(tomPitch - 0.9) < 1e-5 && tomRow[9] == 'x',
          "a parameter the host moves and a step written in the plugin show on the page (swing " +
              std::to_string(swing) + ", tom pitch " + std::to_string(tomPitch) + ", tom row " + tomRow.toStdString() + ")");
    const juce::String knob = ask(page, "document.querySelector('[data-testid=swing]').getAttribute('aria-valuenow') + '/' + "
                                        "document.querySelector('[data-testid=swing]').getAttribute('aria-valuetext')")
                                  .toString();
    std::printf("     the page's swing knob now reads %s\n", knob.toRawUTF8());

    // Neither side sends the other's change back for ever.
    const juce::String settled = ask(page, "JSON.stringify(window.__panel.project())").toString();
    wait(600);
    check(ask(page, "JSON.stringify(window.__panel.project())").toString() == settled &&
              std::abs(parameter(plugin, ids::kSwing) - 0.8f) < 1e-6f,
          "and then both sides rest: nothing is passed back and forth");

    // The sequencer's switch, which is what play and stop are in a host.
    ask(page, "document.querySelector('[data-testid=stop]').click()");
    wait(300);
    const bool stopped = parameter(plugin, ids::kSequencer) < 0.5f;
    ask(page, "document.querySelector('[data-testid=play]').click()");
    wait(300);
    check(stopped && parameter(plugin, ids::kSequencer) >= 0.5f,
          "the page's stop and play keys turn the plugin's sequencer off and on");
  }

  // To look at it: BOOMBAPBOT_HOLD_WINDOW=5 keeps the window up that many seconds.
  wait(1000 * juce::SystemStats::getEnvironmentVariable("BOOMBAPBOT_HOLD_WINDOW", "0").getIntValue());
  window->removeFromDesktop();
  plugin.editorBeingDeleted(window);
  delete window;
  plugin.releaseResources();
  std::printf("%d failed\n", failures);
  return failures == 0 ? 0 : 1;
}
