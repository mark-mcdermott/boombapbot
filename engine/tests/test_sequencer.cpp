// What plays in each measure: the A and B versions, intros and fill-ins, the
// automatic fill-in, and a rhythm chosen during the first beat.

#include <vector>

#include "../src/sequencer.h"
#include "../tools/render.h"
#include "test_util.h"

using namespace snare::test;

namespace {

constexpr double kRate = 48000.0;
constexpr double kBpm = 120.0;       // a tick is 1000 frames
constexpr int kBeat = 24000;
constexpr int kMeasure = 2 * kBeat;  // eight steps of four to the beat

SnarePanel panelOf(int rhythm, int variation = SNARE_VARIATION_A, int fill = 12, int autoFill = 0) {
  SnarePanel panel{};
  panel.rhythm = static_cast<std::uint8_t>(rhythm);
  panel.variation = static_cast<std::uint8_t>(variation);
  panel.fill_rhythm = static_cast<std::uint8_t>(fill);
  panel.fill_variation = SNARE_VARIATION_A;
  panel.auto_fill = static_cast<std::uint8_t>(autoFill);
  panel.first_beat_rule = 1;
  return panel;
}

// Every pattern of the bank is two beats long and clicks on every step.
SnareEngine* makeEngine(const SnarePanel& panel) {
  SnareEngine* engine = snare_engine_create(kRate);
  makeUnity(engine);
  snare_engine_enable_event_log(engine, 8192);
  giveSound(engine, 0, constant(8, 0.25f), kRate);
  SnarePattern pattern = shape(8);
  pattern.rows[1] = 0xffffffffu;
  for (int index = 0; index < SNARE_PATTERNS; ++index) snare_engine_set_pattern(engine, index, &pattern);
  snare_engine_set_tempo(engine, kBpm);
  snare_engine_set_panel(engine, &panel);
  return engine;
}

std::vector<SnareMeasure> readMeasures(SnareEngine* engine) {
  std::vector<SnareMeasure> measures(512);
  measures.resize(static_cast<std::size_t>(snare_engine_read_measures(engine, measures.data(), 512)));
  return measures;
}

std::vector<int> patterns(const std::vector<SnareMeasure>& measures) {
  std::vector<int> out;
  for (const SnareMeasure& measure : measures) out.push_back(measure.pattern);
  return out;
}

// The patterns of the measures a panel plays, with nothing changed on the way.
std::vector<int> play(const SnarePanel& panel, int measures, bool intro = false) {
  SnareEngine* engine = makeEngine(panel);
  if (intro) snare_engine_arm_fill(engine, 1);
  snare_engine_play_measures(engine, measures);
  snare::io::render(engine, measures * kMeasure + 100, 512);
  const std::vector<int> out = patterns(readMeasures(engine));
  snare_engine_destroy(engine);
  return out;
}

}  // namespace

SNARE_TEST(a_variation_switch_on_a_or_b_plays_only_that_version) {
  CHECK(play(panelOf(3, SNARE_VARIATION_A), 3) == (std::vector<int>{6, 6, 6}));
  CHECK(play(panelOf(3, SNARE_VARIATION_B), 3) == (std::vector<int>{7, 7, 7}));
}

SNARE_TEST(ab_alternates_beginning_with_a) {
  CHECK(play(panelOf(3, SNARE_VARIATION_AB), 5) == (std::vector<int>{6, 7, 6, 7, 6}));
}

SNARE_TEST(a_switch_moved_to_ab_carries_on_from_the_version_playing) {
  for (int from : {SNARE_VARIATION_A, SNARE_VARIATION_B}) {
    SnareEngine* engine = makeEngine(panelOf(2, from));
    snare_engine_play(engine);
    snare::io::render(engine, kMeasure + kBeat, 512);  // the middle of the second measure
    const SnarePanel ab = panelOf(2, SNARE_VARIATION_AB);
    snare_engine_set_panel(engine, &ab);
    snare::io::render(engine, 3 * kMeasure, 512);
    const int first = from == SNARE_VARIATION_A ? 4 : 5;
    const int other = first == 4 ? 5 : 4;
    // The new position is heard from the first beat of the following measure.
    CHECK(patterns(readMeasures(engine)) == (std::vector<int>{first, first, other, first, other}));
    snare_engine_destroy(engine);
  }
}

SNARE_TEST(a_tapped_fill_in_plays_once_at_the_bar_line_and_hands_back) {
  SnareEngine* engine = makeEngine(panelOf(2, SNARE_VARIATION_A, 13));
  snare_engine_play(engine);
  snare::io::render(engine, kMeasure + kBeat, 512);
  snare_engine_arm_fill(engine, 1);
  snare::io::render(engine, 3 * kMeasure, 512);
  const std::vector<SnareMeasure> measures = readMeasures(engine);
  CHECK(patterns(measures) == (std::vector<int>{4, 4, 26, 4, 4}));
  CHECK_EQ(measures[1].kind, SNARE_MEASURE_BASIC);
  CHECK_EQ(measures[2].kind, SNARE_MEASURE_FILL);
  CHECK_EQ(measures[3].kind, SNARE_MEASURE_BASIC);
  CHECK_EQ(measures[2].frame, 2.0 * kMeasure);
  // Every step of the fill-in measure, and only those, came from its pattern.
  for (const SnareEvent& event : readEvents(engine)) {
    const bool inFill = event.frame >= 2.0 * kMeasure && event.frame < 3.0 * kMeasure;
    CHECK_EQ(event.pattern, inFill ? 26 : 4);
  }
  snare_engine_destroy(engine);
}

SNARE_TEST(an_armed_fill_in_can_be_cancelled_before_it_plays) {
  SnareEngine* engine = makeEngine(panelOf(2));
  snare_engine_play(engine);
  snare::io::render(engine, kBeat, 512);
  snare_engine_arm_fill(engine, 1);
  snare::io::render(engine, 1000, 512);
  snare_engine_arm_fill(engine, 0);
  snare::io::render(engine, 2 * kMeasure, 512);
  CHECK(patterns(readMeasures(engine)) == (std::vector<int>{4, 4, 4}));
  snare_engine_destroy(engine);
}

SNARE_TEST(a_fill_in_armed_before_start_is_the_intro_then_a_then_b) {
  SnarePanel panel = panelOf(1, SNARE_VARIATION_AB, 14);
  panel.fill_variation = SNARE_VARIATION_B;
  CHECK(play(panel, 4, true) == (std::vector<int>{29, 2, 3, 2}));
  SnareEngine* engine = makeEngine(panel);
  snare_engine_arm_fill(engine, 1);
  snare_engine_play_measures(engine, 2);
  snare::io::render(engine, 2 * kMeasure, 512);
  const std::vector<SnareMeasure> measures = readMeasures(engine);
  CHECK_EQ(measures[0].kind, SNARE_MEASURE_INTRO);
  CHECK_EQ(measures[1].kind, SNARE_MEASURE_BASIC);
  // It was used up: the next start has no intro.
  snare_engine_play_measures(engine, 1);
  snare::io::render(engine, kMeasure, 512);
  CHECK(patterns(readMeasures(engine)) == (std::vector<int>{2}));
  snare_engine_destroy(engine);
}

SNARE_TEST(the_automatic_fill_in_comes_every_so_many_measures) {
  for (int every : {2, 4, 8, 12, 16}) {
    const std::vector<int> played = play(panelOf(0, SNARE_VARIATION_A, 12, every), every * 2 + 1);
    for (std::size_t i = 0; i < played.size(); ++i) {
      CHECK_EQ(played[i], (i + 1) % static_cast<std::size_t>(every) == 0 ? 24 : 0);
    }
  }
}

SNARE_TEST(an_intro_is_not_counted_and_a_tapped_fill_in_is) {
  CHECK(play(panelOf(0, SNARE_VARIATION_A, 12, 4), 9, true) ==
        (std::vector<int>{24, 0, 0, 0, 24, 0, 0, 0, 24}));

  SnareEngine* engine = makeEngine(panelOf(0, SNARE_VARIATION_A, 12, 4));
  snare_engine_play(engine);
  snare::io::render(engine, kBeat, 512);
  snare_engine_arm_fill(engine, 1);  // heard as the second measure
  snare::io::render(engine, 8 * kMeasure, 512);
  CHECK(patterns(readMeasures(engine)) == (std::vector<int>{0, 24, 0, 24, 0, 0, 0, 24, 0}));
  snare_engine_destroy(engine);
}

SNARE_TEST(ab_keeps_its_turn_across_a_fill_in) {
  CHECK(play(panelOf(5, SNARE_VARIATION_AB, 12, 2), 6) == (std::vector<int>{10, 24, 11, 24, 10, 24}));
}

SNARE_TEST(a_rhythm_chosen_after_the_first_beat_waits_for_the_bar_line) {
  SnareEngine* engine = makeEngine(panelOf(2));
  snare_engine_play(engine);
  snare::io::render(engine, kBeat + 3000, 512);
  const SnarePanel next = panelOf(7);
  snare_engine_set_panel(engine, &next);
  snare::io::render(engine, 2 * kMeasure, 512);
  CHECK(patterns(readMeasures(engine)) == (std::vector<int>{4, 14, 14}));
  for (const SnareEvent& event : readEvents(engine)) CHECK_EQ(event.pattern, event.frame < kMeasure ? 4 : 14);
  snare_engine_destroy(engine);
}

SNARE_TEST(a_rhythm_chosen_during_the_first_beat_starts_on_the_second) {
  SnareEngine* engine = makeEngine(panelOf(2, SNARE_VARIATION_B));
  snare_engine_play(engine);
  snare::io::render(engine, kMeasure + 3000, 512);  // early in the second measure
  const SnarePanel next = panelOf(7, SNARE_VARIATION_B);
  snare_engine_set_panel(engine, &next);
  snare::io::render(engine, 2 * kMeasure, 512);

  const std::vector<SnareMeasure> measures = readMeasures(engine);
  // The second measure is logged twice: as it began, and as the new rhythm.
  CHECK(patterns(measures) == (std::vector<int>{5, 5, 15, 15, 15}));
  CHECK_EQ(measures[1].ordinal, 2);
  CHECK_EQ(measures[2].ordinal, 2);
  CHECK_EQ(measures[2].frame, static_cast<double>(kMeasure));
  CHECK_EQ(measures[3].ordinal, 3);

  // Its first beat is the old rhythm and the rest is the new one, on the
  // same steps: no step is lost or played twice.
  const std::vector<SnareEvent> events = readEvents(engine);
  for (std::size_t i = 0; i < events.size(); ++i) {
    CHECK_EQ(events[i].frame, 6000.0 * static_cast<double>(i));
    CHECK_EQ(events[i].step, static_cast<int>(i % 8));
    CHECK_EQ(events[i].pattern, events[i].frame < kMeasure + kBeat ? 5 : 15);
  }
  snare_engine_destroy(engine);
}

SNARE_TEST(the_takeover_lands_on_the_second_beat_of_a_rhythm_with_another_step_size) {
  SnareEngine* engine = makeEngine(panelOf(0));
  // Rhythm 2 is two beats of triplets with a 2nd part: two steps, then four.
  SnarePattern triplets = shape(2, 4, 3);
  triplets.rows[1] = 0xffffffffu;
  snare_engine_set_pattern(engine, 2, &triplets);
  snare_engine_play(engine);
  snare::io::render(engine, 2000, 512);
  const SnarePanel next = panelOf(1);
  snare_engine_set_panel(engine, &next);
  snare::io::render(engine, 2 * kMeasure - 2000, 512);

  std::vector<double> frames;
  std::vector<int> steps;
  for (const SnareEvent& event : readEvents(engine)) {
    if (event.frame >= kMeasure) break;
    frames.push_back(event.frame);
    steps.push_back(event.step);
    CHECK_EQ(event.pattern, event.frame < kBeat ? 0 : 2);
  }
  CHECK(frames == (std::vector<double>{0, 6000, 12000, 18000, 24000, 32000, 40000}));
  CHECK(steps == (std::vector<int>{0, 1, 2, 3, 17, 18, 19}));  // the 2nd part's own steps
  CHECK(patterns(readMeasures(engine)) == (std::vector<int>{0, 2, 2}));
  snare_engine_destroy(engine);
}

SNARE_TEST(the_first_beat_rule_can_be_off_and_never_cuts_into_a_fill_in) {
  SnarePanel plain = panelOf(2);
  plain.first_beat_rule = 0;
  SnareEngine* engine = makeEngine(plain);
  snare_engine_play(engine);
  snare::io::render(engine, 3000, 512);
  SnarePanel next = panelOf(7);
  next.first_beat_rule = 0;
  snare_engine_set_panel(engine, &next);
  snare::io::render(engine, 2 * kMeasure, 512);
  CHECK(patterns(readMeasures(engine)) == (std::vector<int>{4, 14, 14}));
  snare_engine_destroy(engine);

  engine = makeEngine(panelOf(2));
  snare_engine_arm_fill(engine, 1);
  snare_engine_play(engine);
  snare::io::render(engine, 3000, 512);
  const SnarePanel other = panelOf(7);
  snare_engine_set_panel(engine, &other);
  snare::io::render(engine, 2 * kMeasure, 512);
  CHECK(patterns(readMeasures(engine)) == (std::vector<int>{24, 14, 14}));
  snare_engine_destroy(engine);
}

SNARE_TEST(a_rhythm_one_beat_long_waits_for_the_bar_line) {
  SnareEngine* engine = makeEngine(panelOf(0));
  const SnarePattern beat = shape(4);
  snare_engine_set_pattern(engine, 2, &beat);
  snare_engine_play(engine);
  snare::io::render(engine, 2000, 512);
  const SnarePanel next = panelOf(1);
  snare_engine_set_panel(engine, &next);
  snare::io::render(engine, kMeasure + kBeat, 512);
  const std::vector<SnareMeasure> measures = readMeasures(engine);
  CHECK(patterns(measures) == (std::vector<int>{0, 2, 2}));
  CHECK_EQ(measures[1].frame, static_cast<double>(kMeasure));
  CHECK_EQ(measures[2].frame, static_cast<double>(kMeasure + kBeat));
  snare_engine_destroy(engine);
}

SNARE_TEST(a_cued_pattern_and_the_panel_take_over_from_each_other) {
  SnareEngine* engine = makeEngine(panelOf(4, SNARE_VARIATION_AB));
  snare_engine_play(engine);
  snare::io::render(engine, kBeat, 512);
  snare_engine_cue_pattern(engine, 30);
  snare::io::render(engine, 2 * kMeasure, 512);
  const SnarePanel panel = panelOf(4, SNARE_VARIATION_AB);
  snare_engine_set_panel(engine, &panel);
  snare::io::render(engine, 2 * kMeasure, 512);
  CHECK(patterns(readMeasures(engine)) == (std::vector<int>{8, 30, 30, 9, 8}));
  snare_engine_destroy(engine);
}

SNARE_TEST(the_measure_log_is_drained_and_survives_being_left_unread) {
  SnareEngine* engine = makeEngine(panelOf(0));
  const SnarePattern step = shape(1, 0, 8);
  for (int index = 0; index < SNARE_PATTERNS; ++index) snare_engine_set_pattern(engine, index, &step);
  snare_engine_play(engine);
  snare::io::render(engine, 3000 * 10, 512);  // ten one-step measures
  std::vector<SnareMeasure> measures = readMeasures(engine);
  CHECK_EQ(measures.size(), 10u);
  for (std::size_t i = 0; i < measures.size(); ++i) {
    CHECK_EQ(measures[i].ordinal, static_cast<int>(i) + 1);
    CHECK_EQ(measures[i].frame, 3000.0 * static_cast<double>(i));
  }
  CHECK(readMeasures(engine).empty());

  snare::io::render(engine, 3000 * 400, 512);  // far more than the log holds
  measures = readMeasures(engine);
  CHECK_EQ(measures.size(), 255u);
  CHECK_EQ(measures[0].ordinal, 11);
  snare::io::render(engine, 3000 * 3, 512);
  CHECK_EQ(readMeasures(engine).size(), 3u);
  CHECK_EQ(snare_engine_is_playing(engine), 1);
  snare_engine_destroy(engine);
}

// ---- Songs: what a rhythm track plays --------------------------------------

namespace {

std::vector<int> positions(const std::vector<SnareMeasure>& measures) {
  std::vector<int> out;
  for (const SnareMeasure& measure : measures) out.push_back(measure.position);
  return out;
}

void setSong(SnareEngine* engine, const std::vector<std::uint8_t>& rhythms, bool loop) {
  CHECK_EQ(snare_engine_set_song(engine, rhythms.data(), static_cast<int>(rhythms.size()), loop ? 1 : 0), SNARE_OK);
}

}  // namespace

SNARE_TEST(a_song_plays_its_measures_in_order_and_stops_at_the_end) {
  SnareEngine* engine = makeEngine(panelOf(9, SNARE_VARIATION_A, 12, 2));
  setSong(engine, {3, 3, 5, 12, 0}, false);
  snare_engine_play(engine);
  snare::io::render(engine, 7 * kMeasure, 512);
  const std::vector<SnareMeasure> measures = readMeasures(engine);
  // The panel's own rhythm and its automatic fill-in stay out of it.
  CHECK(patterns(measures) == (std::vector<int>{6, 6, 10, 24, 0}));
  CHECK(positions(measures) == (std::vector<int>{0, 1, 2, 3, 4}));
  CHECK_EQ(measures[3].kind, SNARE_MEASURE_FILL);
  CHECK_EQ(snare_engine_is_playing(engine), 0);
  CHECK_EQ(snare_engine_stop_frame(engine), 5.0 * kMeasure);
  CHECK_EQ(static_cast<int>(readEvents(engine).size()), 5 * 8);
  snare_engine_destroy(engine);
}

SNARE_TEST(a_looping_song_starts_over) {
  SnareEngine* engine = makeEngine(panelOf(0));
  setSong(engine, {1, 2, 3}, true);
  snare_engine_play(engine);
  snare::io::render(engine, 7 * kMeasure + 100, 512);
  const std::vector<SnareMeasure> measures = readMeasures(engine);
  CHECK(patterns(measures) == (std::vector<int>{2, 4, 6, 2, 4, 6, 2, 4}));
  CHECK(positions(measures) == (std::vector<int>{0, 1, 2, 0, 1, 2, 0, 1}));
  CHECK_EQ(measures[7].ordinal, 8);
  CHECK_EQ(snare_engine_is_playing(engine), 1);
  snare_engine_destroy(engine);
}

SNARE_TEST(a_song_remembers_rhythms_and_the_switches_choose_the_versions) {
  SnarePanel panel = panelOf(0, SNARE_VARIATION_B);
  panel.fill_variation = SNARE_VARIATION_B;
  SnareEngine* engine = makeEngine(panel);
  setSong(engine, {4, 13, 4, 4, 4, 4}, false);
  snare_engine_play(engine);
  snare::io::render(engine, 2 * kMeasure + kBeat, 512);  // into the third measure
  panel.variation = SNARE_VARIATION_AB;
  panel.fill_variation = SNARE_VARIATION_A;
  snare_engine_set_panel(engine, &panel);
  snare::io::render(engine, 4 * kMeasure, 512);
  // B while the switch said B, then B, A, B from where it stood.
  CHECK(patterns(readMeasures(engine)) == (std::vector<int>{9, 27, 9, 8, 9, 8}));
  snare_engine_destroy(engine);

  std::uint8_t out[6];
  const std::uint8_t rhythms[6] = {4, 13, 4, 4, 15, 4};
  panel.variation = SNARE_VARIATION_AB;
  panel.fill_variation = SNARE_VARIATION_B;
  CHECK_EQ(snare_song_patterns(&panel, rhythms, 6, out), 6);
  CHECK(std::vector<int>(out, out + 6) == (std::vector<int>{8, 27, 9, 8, 31, 9}));
  CHECK_EQ(snare_song_patterns(&panel, rhythms, 0, out), 0);
  CHECK_EQ(snare_song_patterns(nullptr, rhythms, 6, out), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_song_patterns(&panel, rhythms, 6, nullptr), SNARE_ERR_BAD_ARGUMENT);
}

SNARE_TEST(a_rhythm_chosen_while_a_song_plays_takes_its_place_from_there_on) {
  SnareEngine* engine = makeEngine(panelOf(0));
  setSong(engine, {1, 1, 1, 1, 1, 1}, false);
  snare_engine_play(engine);
  snare::io::render(engine, kMeasure + kBeat + 100, 512);  // past the first beat of the second measure
  const SnarePanel chosen = panelOf(7);
  snare_engine_set_panel(engine, &chosen);
  snare::io::render(engine, 6 * kMeasure, 512);
  const std::vector<SnareMeasure> measures = readMeasures(engine);
  CHECK(patterns(measures) == (std::vector<int>{2, 2, 14, 14, 14, 14}));
  CHECK(positions(measures) == (std::vector<int>{0, 1, 2, 3, 4, 5}));
  // The song's length is what it was.
  CHECK_EQ(snare_engine_stop_frame(engine), 6.0 * kMeasure);
  snare_engine_destroy(engine);
}

SNARE_TEST(chosen_during_the_first_beat_it_is_that_measure_that_changes) {
  SnareEngine* engine = makeEngine(panelOf(0));
  setSong(engine, {1, 1, 1, 1}, false);
  snare_engine_play(engine);
  snare::io::render(engine, kMeasure + 3000, 512);
  const SnarePanel chosen = panelOf(7);
  snare_engine_set_panel(engine, &chosen);
  snare::io::render(engine, 4 * kMeasure, 512);
  const std::vector<SnareMeasure> measures = readMeasures(engine);
  // The second measure is reported again, as the rhythm that took it over.
  CHECK(patterns(measures) == (std::vector<int>{2, 2, 14, 14, 14}));
  CHECK(positions(measures) == (std::vector<int>{0, 1, 1, 2, 3}));
  CHECK_EQ(measures[1].ordinal, measures[2].ordinal);
  snare_engine_destroy(engine);
}

SNARE_TEST(a_tapped_fill_in_takes_one_measure_of_a_song) {
  SnareEngine* engine = makeEngine(panelOf(0, SNARE_VARIATION_A, 14));
  setSong(engine, {1, 2, 3, 4}, false);
  snare_engine_play(engine);
  snare::io::render(engine, kBeat, 512);
  snare_engine_arm_fill(engine, 1);
  snare::io::render(engine, 4 * kMeasure, 512);
  const std::vector<SnareMeasure> measures = readMeasures(engine);
  CHECK(patterns(measures) == (std::vector<int>{2, 28, 6, 8}));
  CHECK(positions(measures) == (std::vector<int>{0, 1, 2, 3}));
  snare_engine_destroy(engine);
}

SNARE_TEST(a_long_song_crosses_to_the_engine_whole) {
  std::vector<std::uint8_t> rhythms(SNARE_SONG_MEASURES);
  for (std::size_t i = 0; i < rhythms.size(); ++i) rhythms[i] = static_cast<std::uint8_t>((i * 7 + i / 5) % SNARE_BASIC_RHYTHMS);
  SnareEngine* engine = makeEngine(panelOf(0));
  const SnarePattern step = shape(1, 0, 8);  // 3000 frames a measure
  for (int index = 0; index < SNARE_PATTERNS; ++index) snare_engine_set_pattern(engine, index, &step);
  setSong(engine, rhythms, false);
  snare_engine_play(engine);
  std::vector<int> played;
  for (int pass = 0; pass < 8; ++pass) {
    snare::io::render(engine, 3000 * 100, 512);
    for (int pattern : patterns(readMeasures(engine))) played.push_back(pattern);
  }
  CHECK_EQ(played.size(), rhythms.size());
  bool same = played.size() == rhythms.size();
  for (std::size_t i = 0; same && i < rhythms.size(); ++i) same = played[i] == rhythms[i] * 2;
  CHECK(same);
  CHECK_EQ(snare_engine_is_playing(engine), 0);
  snare_engine_destroy(engine);
}

SNARE_TEST(a_song_can_be_replaced_or_removed_while_it_plays) {
  SnareEngine* engine = makeEngine(panelOf(5));
  setSong(engine, {1, 1, 1, 1, 1, 1}, true);
  snare_engine_play(engine);
  snare::io::render(engine, kMeasure + kBeat, 512);
  setSong(engine, {2, 2, 2, 2, 2, 2}, true);  // carries on from the third measure
  snare::io::render(engine, 2 * kMeasure, 512);
  setSong(engine, {}, false);  // back to the panel's rhythm
  snare::io::render(engine, 2 * kMeasure, 512);
  const std::vector<SnareMeasure> measures = readMeasures(engine);
  CHECK(patterns(measures) == (std::vector<int>{2, 2, 4, 4, 10, 10}));
  CHECK(positions(measures) == (std::vector<int>{0, 1, 2, 3, -1, -1}));
  CHECK_EQ(snare_engine_is_playing(engine), 1);
  snare_engine_destroy(engine);
}

SNARE_TEST(song_arguments_are_checked) {
  SnareEngine* engine = snare_engine_create(kRate);
  const std::uint8_t good[2] = {0, 15};
  const std::uint8_t bad[2] = {0, 16};
  std::vector<std::uint8_t> tooLong(SNARE_SONG_MEASURES + 1, 0);
  CHECK_EQ(snare_engine_set_song(engine, good, 2, 0), SNARE_OK);
  CHECK_EQ(snare_engine_set_song(engine, nullptr, 0, 0), SNARE_OK);
  CHECK_EQ(snare_engine_set_song(engine, bad, 2, 0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_song(engine, nullptr, 2, 0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_song(engine, good, -1, 0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_song(engine, tooLong.data(), SNARE_SONG_MEASURES + 1, 0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_song(nullptr, good, 2, 0), SNARE_ERR_BAD_ARGUMENT);
  // A queue too full for the whole song says so, and the song is not half taken.
  int result = SNARE_OK;
  for (int i = 0; i < 2000 && result == SNARE_OK; ++i) result = snare_engine_set_tempo(engine, 100.0 + i);
  CHECK_EQ(snare_engine_set_song(engine, tooLong.data(), SNARE_SONG_MEASURES, 1), SNARE_ERR_QUEUE_FULL);
  snare::io::render(engine, 16, 16);
  CHECK_EQ(snare_engine_set_song(engine, good, 2, 0), SNARE_OK);
  snare_engine_destroy(engine);
}

SNARE_TEST(the_sequencer_alone_follows_the_same_rules) {
  snare::Sequencer sequencer;
  SnarePanel panel = panelOf(3, SNARE_VARIATION_AB, 15, 4);
  panel.fill_variation = SNARE_VARIATION_B;
  sequencer.start();
  sequencer.armFill(true);
  std::vector<int> played;
  std::vector<int> kinds;
  for (int measure = 0; measure < 6; ++measure) {
    const snare::MeasureChoice choice = sequencer.next(panel);
    played.push_back(choice.pattern);
    kinds.push_back(choice.kind);
  }
  CHECK(played == (std::vector<int>{31, 6, 7, 6, 31, 7}));
  CHECK(kinds == (std::vector<int>{SNARE_MEASURE_INTRO, SNARE_MEASURE_BASIC, SNARE_MEASURE_BASIC, SNARE_MEASURE_BASIC,
                                   SNARE_MEASURE_FILL, SNARE_MEASURE_BASIC}));
  // A rhythm taking over mid-measure keeps the version that measure began with.
  panel.rhythm = 9;
  CHECK_EQ(sequencer.takeover(panel), 19);
  sequencer.start();
  CHECK_EQ(sequencer.next(panel).pattern, 18);
}

SNARE_TEST(panel_arguments_are_checked) {
  SnareEngine* engine = snare_engine_create(kRate);
  SnarePanel panel = panelOf(0);
  CHECK_EQ(snare_engine_set_panel(engine, &panel), SNARE_OK);
  CHECK_EQ(snare_engine_set_panel(engine, nullptr), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_panel(nullptr, &panel), SNARE_ERR_BAD_ARGUMENT);
  panel.rhythm = SNARE_RHYTHMS;
  CHECK_EQ(snare_engine_set_panel(engine, &panel), SNARE_ERR_BAD_ARGUMENT);
  panel = panelOf(0, 3);
  CHECK_EQ(snare_engine_set_panel(engine, &panel), SNARE_ERR_BAD_ARGUMENT);
  panel = panelOf(0);
  panel.fill_variation = SNARE_VARIATION_AB;
  CHECK_EQ(snare_engine_set_panel(engine, &panel), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_arm_fill(nullptr, 1), SNARE_ERR_BAD_ARGUMENT);
  SnareMeasure measure;
  CHECK_EQ(snare_engine_read_measures(engine, nullptr, 4), 0);
  CHECK_EQ(snare_engine_read_measures(engine, &measure, 0), 0);
  CHECK_EQ(snare_engine_read_measures(nullptr, &measure, 1), 0);
  snare_engine_destroy(engine);
}

SNARE_TEST_MAIN()
