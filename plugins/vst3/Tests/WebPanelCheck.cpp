// Opens the plugin's web view window with no host, in a real window on the
// desktop, and works the page in it: that it loads from inside the plugin,
// that a control on the page moves the plugin, that the plugin moves the
// page, and that the bar under the picture does what it says. macOS only: it turns the system's own run loop while it waits.
//
//   web_panel_check <beat file>

#include "BeatFile.h"
#include "ParameterIds.h"
#include "PluginProcessor.h"
#include "TestLicense.h"
#include "WebPanel/WebPanelEditor.h"

#include <CoreFoundation/CoreFoundation.h>

#include <cmath>
#include <cstdio>
#include <cstring>
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

// For what has no end to wait for: a moment in which nothing should happen.
void wait(int milliseconds) {
  waitFor([] { return false; }, milliseconds);
}

// How long a change is given to cross between the page and the plugin. It
// crosses in a few hundredths of a second; a busy machine can take far longer,
// and a check that waited a fixed time would then read what was not there yet.
constexpr int kPatience = 10000;

bool comes(const std::function<bool()>& done) { return waitFor(done, kPatience); }

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

// Asks the page until its answer is the one wanted, and gives the last answer either way.
juce::var askUntil(juce::WebBrowserComponent& browser, const juce::String& script,
                   const std::function<bool(const juce::var&)>& wanted) {
  const juce::uint32 until = juce::Time::getMillisecondCounter() + static_cast<juce::uint32>(kPatience);
  juce::var answer = ask(browser, script);
  while (!wanted(answer) && juce::Time::getMillisecondCounter() < until) {
    wait(50);
    answer = ask(browser, script);
  }
  return answer;
}

juce::String askUntilText(juce::WebBrowserComponent& browser, const juce::String& script, const juce::String& wanted) {
  return askUntil(browser, script, [&wanted](const juce::var& answer) { return answer.toString() == wanted; }).toString();
}

// Waits until nothing of the page's is on its way to the plugin. The page
// sends its whole beat, so one sent before a change made in the plugin and
// landing after it would take that change back.
void letThePageRest(juce::WebBrowserComponent& browser) {
  askUntil(browser, "window.__panel.atRest()", [](const juce::var& atRest) { return static_cast<bool>(atRest); });
}

// The parts of a check that did not hold, by name, so a failure says which.
struct Parts {
  void add(bool held, const char* name) {
    if (!held) failed << (failed.isEmpty() ? "" : ", ") << name;
  }
  bool held() const { return failed.isEmpty(); }
  std::string report() const { return held() ? "" : " (not so: " + failed.toStdString() + ")"; }

  juce::String failed;
};

float parameter(BoombapbotAudioProcessor& plugin, const juce::String& id) {
  return plugin.parameters().getRawParameterValue(id)->load();
}

// Counts what a host is told of one parameter: its gestures and its changes.
struct Told final : juce::AudioProcessorParameter::Listener {
  explicit Told(juce::AudioProcessorParameter& watched) : parameter(watched) { parameter.addListener(this); }
  ~Told() override { parameter.removeListener(this); }
  void parameterValueChanged(int, float) override { ++changes; }
  void parameterGestureChanged(int, bool starting) override { ++(starting ? begun : ended); }
  void clear() { begun = ended = changes = 0; }

  juce::AudioProcessorParameter& parameter;
  int begun = 0;
  int ended = 0;
  int changes = 0;
};

// The plugin's window on the desktop. A host puts the view inside a window of
// its own, so the view has no title bar to share its size with; nor has this.
BoombapbotWebEditor* openWindow(BoombapbotAudioProcessor& plugin) {
  auto* const window = dynamic_cast<BoombapbotWebEditor*>(plugin.createEditorAndMakeActive());
  if (window == nullptr) return nullptr;
  window->setOpaque(true);
  window->addToDesktop(0);
  window->setTopLeftPosition(60, 80);
  window->setVisible(true);
  window->toFront(false);
  return window;
}

void closeWindow(BoombapbotAudioProcessor& plugin, BoombapbotWebEditor* window) {
  window->removeFromDesktop();
  plugin.editorBeingDeleted(window);
  delete window;
}

juce::String keysOn(const char* control, const char* key, int presses) {
  return juce::String("(() => { const k = document.querySelector('[data-testid=") + control +
         "]'); for (let i = 0; i < " + juce::String(presses) +
         "; i++) k.dispatchEvent(new KeyboardEvent('keydown', {key: '" + key + "', bubbles: true})); })()";
}

void play(BoombapbotAudioProcessor& plugin, int blocks) {
  juce::AudioBuffer<float> block(2, 512);
  juce::MidiBuffer noNotes;
  for (int count = 0; count < blocks; ++count) {
    block.clear();
    plugin.processBlock(block, noNotes);
  }
}

// The effect, which the plugin's parameter and the page's selector both choose.
// The plugin here holds the upgrade by a file a test key signed. The page is
// handed that file and checks it against its own key, which did not sign it,
// so the page's selector stays at the four effects: what a page that holds
// the upgrade does with the six needs a file the server signed.
void checkTheEffect(BoombapbotAudioProcessor& plugin, juce::WebBrowserComponent& page) {
  juce::RangedAudioParameter& effect = *plugin.parameters().getParameter(ids::kEffectKind);
  const auto choose = [&effect](int choice) { effect.setValueNotifyingHost(effect.convertTo0to1(static_cast<float>(choice))); };
  const auto chosen = [&plugin] { return juce::roundToInt(parameter(plugin, ids::kEffectKind)); };
  const char* const kindOnThePage = "window.__panel.project().effect.kind";
  const auto onThePage = [&] { return ask(page, kindOnThePage).toString(); };
  // The page hears of the plugin's change, and the plugin of the page's, a moment later.
  const auto pageComesTo = [&](const juce::String& kind) { return askUntilText(page, kindOnThePage, kind); };
  const auto pluginComesTo = [&chosen](int choice) {
    comes([&] { return chosen() == choice; });
    return chosen();
  };
  // The selector is drawn a moment after the page's beat changes, and a press goes on from what is drawn.
  const auto selectorStandsOn = [&page](const juce::String& kind) {
    askUntilText(page, "document.querySelector('[data-testid=effect]').getAttribute('data-position')", kind);
  };
  letThePageRest(page);
  const float mix = parameter(plugin, ids::kEffectMix);
  const int before = chosen();
  const juce::String kindBefore = onThePage();

  ask(page, "(() => { const b = window.__JUCE__.backend; b.addEventListener('__juce__complete', (done) => { "
            "if (done.promiseId === 4096) window.__handed = done.result; }); "
            "b.emitEvent('__juce__invoke', {name: 'licenseFile', params: [], resultId: 4096}); })()");
  const juce::String handed =
      askUntil(page, "window.__handed", [](const juce::var& answer) { return answer.toString().isNotEmpty(); }).toString();
  check(plugin.holdsUpgrade() && handed.isNotEmpty() && handed == juce::String(plugin.licenseFile()),
        "the plugin hands the page the license file it holds the upgrade by");
  check(!static_cast<bool>(ask(page, "window.__panel.upgraded()")),
        "the page checks the file itself: one its own key did not sign does not unlock the page");

  const juce::StringArray kinds{"delay", "reverb", "flanger", "chorus", "crusher", "tape", "pump", "filter", "vinyl", "phaser"};
  juce::StringArray shown;
  for (int choice = 1; choice <= kinds.size(); ++choice) {
    choose(choice);
    shown.add(pageComesTo(kinds[choice - 1]));
  }
  check(shown == kinds, "each of the ten effects chosen in the plugin is the effect on the page (" +
                            shown.joinIntoString(" ").toStdString() + ")");

  // The page's own change crosses with the effect in it, and the effect stays.
  const float volume = parameter(plugin, ids::kVolume);
  ask(page, keysOn("volume", "ArrowUp", 1));
  Parts kept;
  kept.add(comes([&] { return parameter(plugin, ids::kVolume) > volume; }), "the knob's turn reached the plugin");
  kept.add(chosen() == kinds.size(), "the plugin's effect stayed");
  kept.add(onThePage() == "phaser", "the page's effect stayed");
  kept.add(std::abs(parameter(plugin, ids::kEffectMix) - mix) < 1e-6f, "the effect's mix stayed");
  check(kept.held(), "a knob turned on the page leaves an effect of the upgrade as the plugin chose it" + kept.report());
  const float turned = parameter(plugin, ids::kVolume);
  ask(page, keysOn("volume", "ArrowDown", 1));
  comes([&] { return parameter(plugin, ids::kVolume) < turned; });
  letThePageRest(page);

  // The selector on the page moves the plugin's parameter.
  choose(SNARE_EFFECT_DELAY);
  struct Press {
    const char* from;
    int to;
  };
  juce::String round;
  for (const Press press : {Press{"delay", SNARE_EFFECT_REVERB}, Press{"reverb", SNARE_EFFECT_FLANGER},
                            Press{"flanger", SNARE_EFFECT_CHORUS}, Press{"chorus", SNARE_EFFECT_DELAY}}) {
    selectorStandsOn(press.from);
    ask(page, "document.querySelector('[data-testid=effect]').click()");
    round << pluginComesTo(press.to) << " ";
  }
  check(round == "2 3 4 1 " && onThePage() == "delay",
        "the page's selector moves the Effect parameter, and without the upgrade on the page goes round the four (" +
            round.trim().toStdString() + ")");

  letThePageRest(page);
  choose(before);
  pageComesTo(kindBefore);
}

// What the bar under the picture does, and what the host keeps for itself.
void checkTheBar(BoombapbotAudioProcessor& plugin, BoombapbotWebEditor& window, const juce::File& fixture) {
  juce::WebBrowserComponent& page = window.browser();

  // The bar is there, under the picture, and the window is the two of them.
  const juce::String laid = ask(page, "(() => { const p = document.querySelector('[data-testid=plate]').getBoundingClientRect(); "
                                      "const b = document.querySelector('[data-testid=bar]').getBoundingClientRect(); "
                                      "return [Math.round(p.bottom), Math.round(b.top), Math.round(b.bottom), innerHeight, "
                                      "document.querySelectorAll('.rt-touch').length && "
                                      "getComputedStyle(document.querySelector('.rt-touch')).display].join(' '); })()")
                               .toString();
  const juce::StringArray places = juce::StringArray::fromTokens(laid, false);
  check(places.size() == 5 && std::abs(places[0].getIntValue() - places[1].getIntValue()) <= 2 &&
            std::abs(places[2].getIntValue() - places[3].getIntValue()) <= 2 && places[4] == "none",
        "the bar lies under the picture and ends where the window does (" + laid.toStdString() + ")");

  // The beat's name, both ways.
  ask(page, "(() => { const i = document.querySelector('[data-testid=beat-name]'); i.focus(); "
            "Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '  Named on the page '); "
            "i.dispatchEvent(new Event('input', {bubbles: true})); i.blur(); })()");
  comes([&] { return plugin.beatName() == "Named on the page"; });
  check(plugin.beatName() == "Named on the page", "a name typed in the bar is the plugin's beat name, tidied (" +
                                                      plugin.beatName().toStdString() + ")");
  letThePageRest(page);
  plugin.setBeatName("Named in the plugin");
  const juce::String shown =
      askUntilText(page, "document.querySelector('[data-testid=beat-name]').value", "Named in the plugin");
  check(shown == "Named in the plugin", "and a name set in the plugin shows in the bar (" + shown.toStdString() + ")");

  // Undo: a step written on the page is one step back.
  const auto undoIsOffered = [&page] {
    return !static_cast<bool>(askUntil(page, "document.querySelector('[data-testid=undo]').disabled",
                                       [](const juce::var& disabled) { return !static_cast<bool>(disabled); }));
  };
  ask(page, "document.querySelector('[data-testid=pattern-2]').click()");
  ask(page, "document.querySelector('[data-testid=voice-kick]').click()");
  Parts undone;
  undone.add(comes([&] { return juce::roundToInt(parameter(plugin, ids::kPattern)) == 1 && plugin.selectedVoice() == 0; }),
             "pattern 2 and the kick were chosen in the plugin");
  const bool stepBefore = plugin.stepOn(1, 0, 6);
  ask(page, "document.querySelector('[data-testid=step-7]').click()");
  undone.add(comes([&] { return plugin.stepOn(1, 0, 6) != stepBefore; }), "the step was written in the plugin");
  undone.add(undoIsOffered(), "the bar's undo key was offered");
  ask(page, "document.querySelector('[data-testid=undo]').click()");
  undone.add(comes([&] { return plugin.stepOn(1, 0, 6) == stepBefore; }), "the step went back in the plugin");
  const juce::String kickRow =
      askUntil(page, "window.__panel.project().patterns[1].steps.kick", [stepBefore](const juce::var& row) {
        return (row.toString()[6] == 'x') == stepBefore;
      }).toString();
  undone.add((kickRow[6] == 'x') == stepBefore, "the step went back on the page");
  check(undone.held(), "a step written on the page can be taken back with the bar's undo, in the plugin and on the page" +
                           undone.report());

  // The meter reads what the plugin plays. The key's press is on its way to
  // the audio thread, so blocks are played until it has sounded.
  ask(page, "document.querySelector('[data-testid=voice-kick]').click()");
  comes([&] {
    play(plugin, 1);
    return plugin.outputLevel() > 0.001f;
  });
  const double level =
      askUntil(page, "window.__panel.level()", [](const juce::var& heard) { return static_cast<double>(heard) > 0.001; });
  check(plugin.outputLevel() > 0.001f && level > 0.001,
        "the page's meter is given how loud the plugin is (" + std::to_string(level) + ")");

  // A knob held is one gesture to the host, however far it turns; a change with no hold is a gesture by itself.
  Told volume(*plugin.parameters().getParameter(ids::kVolume));
  ask(page, "document.querySelector('[data-testid=volume]').dispatchEvent("
            "new PointerEvent('pointerdown', {bubbles: true, pointerId: 1}))");
  ask(page, keysOn("volume", "ArrowUp", 1));
  comes([&] { return volume.changes >= 1; });
  ask(page, keysOn("volume", "ArrowUp", 1));
  comes([&] { return volume.changes >= 2; });
  const bool held = volume.begun == 1 && volume.ended == 0 && volume.changes >= 2;
  ask(page, keysOn("volume", "ArrowDown", 1));
  ask(page, "window.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerId: 1}))");
  comes([&] { return volume.ended >= 1; });
  check(held && volume.begun == 1 && volume.ended == 1 && volume.changes >= 3,
        "a hold on the page's volume knob reaches the host as one gesture around its changes, the last of them "
        "sent before the hand lets go (" +
            std::to_string(volume.begun) + " begun, " + std::to_string(volume.ended) + " ended, " +
            std::to_string(volume.changes) + " changes)");
  volume.clear();
  ask(page, keysOn("volume", "ArrowUp", 1));
  comes([&] { return volume.ended >= 1; });
  check(volume.begun == 1 && volume.ended == 1 && volume.changes == 1,
        "and a change with no hold is a whole gesture by itself");

  // What the host keeps: the tempo, recording, and the power.
  const juce::String kept = ask(page, "['tempo', 'record', 'power'].map(c => "
                                      "document.querySelector('[data-testid=' + c + ']').inert).join(' ')")
                               .toString();
  const int tempo = ask(page, "window.__panel.project().tempo");
  ask(page, keysOn("tempo", "ArrowUp", 5));
  // Long enough for a turn the page took to have gone to the plugin, and then for the host's tempo to come back.
  wait(500);
  const int tempoAfter = askUntil(page, "window.__panel.project().tempo",
                                  [tempo](const juce::var& now) { return static_cast<int>(now) == tempo; });
  check(kept == "true true true" && tempo == tempoAfter && tempo == plugin.currentBeat().tempo,
        "the tempo knob, the record key and the power switch take no hand, and a tempo turned anyway goes back to "
        "the host's (" + std::to_string(tempo) + ")");

  // The files, by the desk the bar's keys work. The dialogs that ask where are the system's and are not opened here.
  const juce::File folder = juce::File::createTempFile("boombapbot-bar");
  folder.createDirectory();
  const juce::File beat = folder.getChildFile("kept.boombapbot.json");
  window.desk().saveBeat(beat);
  const juce::String saved = askUntil(page, "document.querySelector('[data-testid=said]').textContent", [](const juce::var& said) {
                               return said.toString().startsWith("Saved ");
                             }).toString();
  boombapbot::plugin::Beat read;
  check(saved.startsWith("Saved kept.boombapbot.json") &&
            boombapbot::plugin::readBeat(beat.loadFileAsString(), read).wasOk() && read.name == "Named in the plugin",
        "saving a beat writes one the site's reader takes, and the bar says so (" + saved.toStdString() + ")");
  letThePageRest(page);
  window.desk().loadBeat(fixture);
  const juce::String loaded =
      askUntil(page,
               "document.querySelector('[data-testid=said]').textContent + ' / ' + "
               "document.querySelector('[data-testid=beat-name]').value",
               [](const juce::var& said) {
                 return said.toString().startsWith("Loaded ") && said.toString().endsWith("/ Four patterns fixture");
               })
          .toString();
  check(loaded.startsWith("Loaded ") && loaded.endsWith("/ Four patterns fixture"),
        "loading a beat puts it on the page, and the bar says so (" + loaded.toStdString() + ")");
  window.desk().loadBeat(juce::File(BOOMBAPBOT_MACHINE_FILE));
  const juce::String refused =
      askUntil(page,
               "document.querySelector('[data-testid=said]').dataset.problem + ': ' + "
               "document.querySelector('[data-testid=said]').textContent",
               [](const juce::var& said) { return said.toString().startsWith("true: "); })
          .toString();
  check(refused.startsWith("true: ") && plugin.beatName() == "Four patterns fixture",
        "a file that is not a beat is refused in words, and changes nothing (" + refused.toStdString() + ")");
  const juce::File midi = folder.getChildFile("pattern");
  window.desk().saveMidi(midi);
  juce::MemoryBlock bytes;
  folder.getChildFile("pattern.mid").loadFileAsData(bytes);
  check(bytes.getSize() > 14 && std::memcmp(bytes.getData(), "MThd", 4) == 0,
        "saving the pattern as MIDI writes a MIDI file (" + std::to_string(bytes.getSize()) + " bytes)");
  folder.deleteRecursively();
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 2) {
    std::fprintf(stderr, "usage: %s <beat file>\n", argv[0]);
    return 2;
  }
  const juce::ScopedJuceInitialiser_GUI juceInitialiser;

  BoombapbotAudioProcessor plugin(boombapbot::plugin::testing::heldUpgrade());
  plugin.setPlayConfigDetails(0, 2, 48000.0, 512);
  plugin.prepareToPlay(48000.0, 512);
  const juce::Result loaded = plugin.loadBeat(
      juce::File::getCurrentWorkingDirectory().getChildFile(juce::String::fromUTF8(argv[1])).loadFileAsString());
  check(loaded.wasOk(), "the plugin holds the fixture beat");

  const juce::File fixture = juce::File::getCurrentWorkingDirectory().getChildFile(juce::String::fromUTF8(argv[1]));
  const juce::uint32 opened = juce::Time::getMillisecondCounter();
  BoombapbotWebEditor* window = openWindow(plugin);
  check(window != nullptr, "the plugin's window is the web view");
  if (window == nullptr) return 1;
  check(window->getWidth() == BoombapbotWebEditor::kWidth && window->getHeight() == BoombapbotWebEditor::kHeight,
        "it opens at its own size (" + std::to_string(window->getWidth()) + " x " + std::to_string(window->getHeight()) + ")");

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
    Parts pressed;
    pressed.add(comes([&] { return plugin.selectedVoice() == 5 && juce::roundToInt(parameter(plugin, ids::kPattern)) == 0; }),
                "pattern 1 and the tom were chosen in the plugin");
    const bool before = plugin.stepOn(0, 5, 2);
    ask(page, "document.querySelector('[data-testid=step-3]').click()");
    pressed.add(comes([&] { return plugin.stepOn(0, 5, 2) != before; }), "the step was written in the plugin");
    check(pressed.held(),
          "on the page, choosing pattern 1 and the tom and pressing step key 3 writes that step in the plugin" +
              pressed.report());

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
    comes([&] { return parameter(plugin, ids::kVolume) < volumeBefore - 0.005f; });
    const float volumeAfter = parameter(plugin, ids::kVolume);
    check(volumeAfter < volumeBefore - 0.005f,
          "turning the page's volume knob down moves the host's Volume parameter (" + std::to_string(volumeBefore) +
              " to " + std::to_string(volumeAfter) + ")");

    // The plugin to the page: a parameter the host automates, and a step written elsewhere.
    letThePageRest(page);
    plugin.parameters().getParameter(ids::kSwing)->setValueNotifyingHost(0.8f);
    plugin.parameters().getParameter("tom_pitch")->setValueNotifyingHost(0.9f);
    plugin.setStep(0, 5, 9, true);
    askUntil(page, "(() => { const p = window.__panel.project(); return Math.abs(p.swing - 0.8) < 1e-5 && "
                   "Math.abs(p.voices.tom.pitch - 0.9) < 1e-5 && p.patterns[0].steps.tom[9] === 'x'; })()",
             [](const juce::var& shown) { return static_cast<bool>(shown); });
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
    const bool stopped = comes([&] { return parameter(plugin, ids::kSequencer) < 0.5f; });
    ask(page, "document.querySelector('[data-testid=play]').click()");
    check(stopped && comes([&] { return parameter(plugin, ids::kSequencer) >= 0.5f; }),
          "the page's stop and play keys turn the plugin's sequencer off and on");

    checkTheEffect(plugin, page);
    checkTheBar(plugin, *window, fixture);
  }

  // To look at it: BOOMBAPBOT_HOLD_WINDOW=5 keeps the window up that many seconds.
  wait(1000 * juce::SystemStats::getEnvironmentVariable("BOOMBAPBOT_HOLD_WINDOW", "0").getIntValue());

  // The size the window is left at is the size it opens at next.
  window->setSize(BoombapbotWebEditor::kWidth * 5 / 4, BoombapbotWebEditor::kHeight * 5 / 4);
  wait(200);
  const int leftAt = window->getWidth();
  closeWindow(plugin, window);
  window = openWindow(plugin);
  check(window != nullptr && leftAt == BoombapbotWebEditor::kWidth * 5 / 4 && window->getWidth() == leftAt &&
            std::abs(plugin.windowScale() - 1.25f) < 0.01f,
        "left a quarter larger, the window opens a quarter larger (" + std::to_string(leftAt) + " wide)");
  if (window != nullptr) closeWindow(plugin, window);
  plugin.releaseResources();
  std::printf("%d failed\n", failures);
  return failures == 0 ? 0 : 1;
}
