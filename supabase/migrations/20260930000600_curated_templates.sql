-- Official (curated) rubric templates. Sources:
--   IML:   internationalmrleather.com/scoring-system (prelim, contest judging, ties)
--   IMBB:  internationalmrleather.com/imbb-scoring-system (panel, prelim, contest judging, ties)
--   IMsL / IMsBB: 2023 IMsLBB Judges Book and 2023 Judging Rubric
-- Not modelled (noted in each description): judges' votes (use "choose the winner"), IMsL/IMsBB cross-panel
-- interview score and the speech overtime deduction.

create function pg_temp.comp(p_name text, p_max numeric, p_desc text default null) returns jsonb language sql as $$
  select jsonb_build_object('name', p_name, 'description', p_desc, 'min_points', 0, 'max_points', p_max, 'step', 1)
$$;
create function pg_temp.cat(p_name text, p_round text, variadic p_comps jsonb[]) returns jsonb language sql as $$
  select jsonb_build_object('name', p_name, 'round', p_round, 'drop_rank', null, 'components', to_jsonb(p_comps))
$$;
create function pg_temp.step(p_all boolean, variadic p_idx int[]) returns jsonb language sql as $$
  select jsonb_build_object('categories', to_jsonb(p_idx), 'all_judges', p_all)
$$;

insert into public.templates (org_id, visibility, name, description, rubric) values
(null, 'curated', 'International Mr. Leather (IML)',
 '9 judges. Prelims (Interview 0–120, Pecs & Personality 0–80), each category dropping its high and low judge; top 20 advance. '
 || 'Finals start fresh: Leather Image 0–40, Presentation Skills 0–40, Physical Appearance 0–20, dropping the judges with the highest and lowest totals. '
 || 'Ties: re-total with every judge, then the judges'' vote (record it with "choose the winner").',
 jsonb_build_object(
   'aggregation', 'drop_high_low_total', 'threshold_pct', null, 'anonymize_comments', true,
   'finalist_count', 20, 'prelim_aggregation', 'drop_high_low', 'prelim_carries', false,
   'categories', jsonb_build_array(
     pg_temp.cat('Preliminary Interview', 'prelim', pg_temp.comp('Interview', 120)),
     pg_temp.cat('Pecs & Personality', 'prelim', pg_temp.comp('Stage presence and personality', 80)),
     pg_temp.cat('Leather Image', 'final', pg_temp.comp('Leather Image', 40)),
     pg_temp.cat('Presentation Skills', 'final', pg_temp.comp('Presentation Skills', 40)),
     pg_temp.cat('Physical Appearance', 'final', pg_temp.comp('Physical Appearance', 20))),
   'tiebreak_steps', jsonb_build_array(pg_temp.step(true, 0, 1, 2, 3, 4)))),

(null, 'curated', 'International Mr. Bootblack (IMBB)',
 '5 judges; every category drops its high and low judge (with 4 judges it reverts to straight scoring automatically). '
 || 'Prelims: Bootblack Skill 0–200, Personal Interview 0–100, Educational Presentation 0–75, Personal Image 0–50; top 5 advance and prelim scores carry into the finals, which add Speech 0–75 (max 1,500). '
 || 'Ties: re-total with every judge, then Bootblack Skill with every judge, then the judges'' vote.',
 jsonb_build_object(
   'aggregation', 'drop_high_low', 'threshold_pct', null, 'anonymize_comments', true,
   'finalist_count', 5, 'prelim_aggregation', 'drop_high_low', 'prelim_carries', true,
   'categories', jsonb_build_array(
     pg_temp.cat('Bootblack Skill', 'prelim', pg_temp.comp('Bootblack Skill', 200)),
     pg_temp.cat('Personal Interview', 'prelim', pg_temp.comp('Personal Interview', 100)),
     pg_temp.cat('Educational Presentation', 'prelim', pg_temp.comp('Educational Presentation', 75)),
     pg_temp.cat('Personal Image', 'prelim', pg_temp.comp('Personal Image', 50)),
     pg_temp.cat('Speech', 'final', pg_temp.comp('Speech', 75))),
   'tiebreak_steps', jsonb_build_array(pg_temp.step(true, 0, 1, 2, 3, 4), pg_temp.step(true, 0)))),

(null, 'curated', 'International Ms Leather (IMsL, 2023)',
 '6 judges, Olympic scoring (each category drops its high and low judge); a recused judge''s slot is the average of the others; 80% minimum to win. '
 || '500 points per judge. Ties: compare Interview, Speech, Public Image, Teaching, Practical Skills, Pop Question in turn, then the contestant-class vote (record it with "choose the winner"). '
 || 'Not modelled: the cross-panel interview score and the 10% speech overtime deduction.',
 jsonb_build_object(
   'aggregation', 'drop_high_low', 'threshold_pct', 80, 'anonymize_comments', true,
   'finalist_count', null, 'prelim_aggregation', 'drop_high_low', 'prelim_carries', false,
   'categories', jsonb_build_array(
     pg_temp.cat('Personal Interview', 'final', pg_temp.comp('Eloquence & Content', 60), pg_temp.comp('Composure', 30), pg_temp.comp('Delivery & Appearance', 10)),
     pg_temp.cat('Public Image / Demeanor', 'final', pg_temp.comp('On-site Demeanor / Public Image', 10), pg_temp.comp('Community Service / Involvement', 20),
                 pg_temp.comp('Intersectional Competency', 50), pg_temp.comp('Social Advocacy', 20)),
     pg_temp.cat('Speech', 'final', pg_temp.comp('Eloquence & Content', 70), pg_temp.comp('Delivery & Appearance', 30)),
     pg_temp.cat('Teaching (pre-recorded)', 'final', pg_temp.comp('Content', 50), pg_temp.comp('Delivery', 25)),
     pg_temp.cat('Practical Skills: Demo', 'final', pg_temp.comp('Content', 30), pg_temp.comp('Question and Answer', 10)),
     pg_temp.cat('Practical Skills: Demo Community Vote', 'final', pg_temp.comp('Community vote', 10, 'Enter the community vote result in every judge''s column')),
     pg_temp.cat('Practical Skills: Fantasy', 'final', pg_temp.comp('Content', 25), pg_temp.comp('Production Value', 25)),
     pg_temp.cat('Pop Question', 'final', pg_temp.comp('On-the-fly Thinking', 25))),
   'tiebreak_steps', jsonb_build_array(pg_temp.step(false, 0), pg_temp.step(false, 2), pg_temp.step(false, 1), pg_temp.step(false, 3),
                                       pg_temp.step(false, 4, 5, 6), pg_temp.step(false, 7)))),

(null, 'curated', 'International Ms Bootblack (IMsBB, 2023)',
 '6 judges, Olympic scoring (each category drops its high and low judge); a recused judge''s slot is the average of the others; 80% minimum to win. '
 || '500 points per judge. Ties: compare Interview, Speech, Public Image, Teaching, Technical Skills, Pop Question in turn, then the contestant-class vote (record it with "choose the winner"). '
 || 'Not modelled: the cross-panel interview score and the 10% speech overtime deduction.',
 jsonb_build_object(
   'aggregation', 'drop_high_low', 'threshold_pct', 80, 'anonymize_comments', true,
   'finalist_count', null, 'prelim_aggregation', 'drop_high_low', 'prelim_carries', false,
   'categories', jsonb_build_array(
     pg_temp.cat('Personal Interview', 'final', pg_temp.comp('Eloquence & Content', 60), pg_temp.comp('Composure', 30), pg_temp.comp('Delivery & Appearance', 10)),
     pg_temp.cat('Public Image / Demeanor', 'final', pg_temp.comp('On-site Demeanor / Public Image', 10), pg_temp.comp('Community Service / Involvement', 20),
                 pg_temp.comp('Intersectional Competency', 50), pg_temp.comp('Social Advocacy', 20)),
     pg_temp.cat('Speech', 'final', pg_temp.comp('Eloquence & Content', 70), pg_temp.comp('Delivery & Appearance', 30)),
     pg_temp.cat('Teaching (pre-recorded)', 'final', pg_temp.comp('Content', 50), pg_temp.comp('Delivery', 25)),
     pg_temp.cat('Technical Skills: Tech Boot & Presentation', 'final', pg_temp.comp('Technical Skill & Approach', 20), pg_temp.comp('Presentation', 20)),
     pg_temp.cat('Technical Skills: Community Boot Vote', 'final', pg_temp.comp('Community vote', 10, 'Enter the community vote result in every judge''s column')),
     pg_temp.cat('Technical Skills: Stand Time', 'final', pg_temp.comp('Bedside Manner', 25), pg_temp.comp('Triage & Technical Skill', 25)),
     pg_temp.cat('Pop Question', 'final', pg_temp.comp('On-the-fly Thinking', 25))),
   'tiebreak_steps', jsonb_build_array(pg_temp.step(false, 0), pg_temp.step(false, 2), pg_temp.step(false, 1), pg_temp.step(false, 3),
                                       pg_temp.step(false, 4, 5, 6), pg_temp.step(false, 7))));
