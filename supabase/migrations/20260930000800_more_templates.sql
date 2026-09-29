-- More official templates, and IMsL/IMsBB updated to use cross-panel judges, the community vote and the
-- speech overtime deduction. Sources: each contest's published 2026 scoring rules (see descriptions).

create function pg_temp.comp(p_name text, p_max numeric, p_step numeric default 1) returns jsonb language sql as $$
  select jsonb_build_object('name', p_name, 'description', null, 'min_points', 0, 'max_points', p_max, 'step', p_step)
$$;
-- A single-component category.
create function pg_temp.cat(p_name text, p_max numeric, p_extra jsonb default '{}', p_step numeric default 1) returns jsonb language sql as $$
  select jsonb_build_object('name', p_name, 'round', 'final', 'drop_rank', null, 'scored_by', 'judges', 'guest_average', false,
                            'deductions', '[]'::jsonb, 'components', jsonb_build_array(pg_temp.comp(p_name, p_max, p_step))) || p_extra
$$;
create function pg_temp.rubric(p_agg text, p_threshold numeric, p_single boolean, p_report text, p_cats jsonb, p_steps jsonb default '[]') returns jsonb language sql as $$
  select jsonb_build_object('aggregation', p_agg, 'threshold_pct', p_threshold, 'threshold_single_only', p_single, 'report_as', p_report,
                            'anonymize_comments', true, 'finalist_count', null, 'prelim_aggregation', 'drop_high_low', 'prelim_carries', false,
                            'categories', p_cats, 'tiebreak_steps', p_steps)
$$;
create function pg_temp.step(variadic p_idx int[]) returns jsonb language sql as $$
  select jsonb_build_object('categories', to_jsonb(p_idx), 'all_judges', false)
$$;

-- ── IMsL / IMsBB 2023: now fully modelled ───────────────────────────────────
update public.templates t set
  description = replace(replace(t.description,
    'Not modelled: the cross-panel interview score and the 10% speech overtime deduction.',
    'The other contest''s judges score the interview as cross-panel judges; their average is a 7th interview score. The tally master applies the 10% speech overtime deduction and enters the community vote. Totals are reported as the average per judge (500 possible).'),
    '500 points per judge. ', ''),
  rubric = t.rubric || jsonb_build_object('report_as', 'average', 'threshold_single_only', false, 'categories', (
    select jsonb_agg(
      case c ->> 'name'
        when 'Personal Interview' then c || '{"guest_average": true}'
        when 'Speech' then c || '{"deductions": [{"label": "Over time", "percent": 10}]}'
        else case when c ->> 'name' like '%Community%Vote' then c || '{"scored_by": "producer"}' else c end
      end order by ord)
    from jsonb_array_elements(t.rubric -> 'categories') with ordinality as x(c, ord)))
where t.visibility = 'curated' and t.name in ('International Ms Leather (IMsL, 2023)', 'International Ms Bootblack (IMsBB, 2023)');

-- ── new templates ───────────────────────────────────────────────────────────
insert into public.templates (org_id, visibility, name, description, rubric) values
(null, 'curated', 'San Diego Leather & Leatherbear (2026)',
 'Olympic scoring, reported as the average per judge; 75% to win. The rules weight 0–100 judge scores by category (Interview 30%, Pop & Circumstance 10%, Personal Ad 10%, Soapbox 20%, Bawdy Baskets 15%, Video Fantasy 15%); here each category is scored out of its weight instead, which gives the same result. '
 || 'Tie: the category with the most weight (Interview). A video without captions and audio description scores 0.',
 pg_temp.rubric('drop_high_low', 75, false, 'average', jsonb_build_array(
   pg_temp.cat('Bare/Bear Yourself (Zoom Interview)', 30, '{}', 0.5), pg_temp.cat('Pop & Circumstance', 10, '{}', 0.5),
   pg_temp.cat('Show Us Your Stuff (Personal Ad)', 10, '{}', 0.5), pg_temp.cat('Style & Soapbox', 20, '{}', 0.5),
   pg_temp.cat('Bawdy Baskets', 15, '{}', 0.5), pg_temp.cat('Video Fantasy', 15, '{}', 0.5)),
   jsonb_build_array(pg_temp.step(0)))),

(null, 'curated', 'San Diego Bootblack (2026)',
 'Olympic scoring, reported as the average per judge; 75% to win. The rules weight 0–100 judge scores by category (Interview 15%, Open Shine 35%, Personal Ad 10%, Soapbox 10%, Tech Boot 20%, Video Fantasy 10%); here each category is scored out of its weight instead, which gives the same result. '
 || 'Tie: the category with the most weight (Open Shine).',
 pg_temp.rubric('drop_high_low', 75, false, 'average', jsonb_build_array(
   pg_temp.cat('Bare Your Sole (Zoom Interview)', 15, '{}', 0.5), pg_temp.cat('Shine On! (Open Shine)', 35, '{}', 0.5),
   pg_temp.cat('Show Us Your Stuff (Personal Ad)', 10, '{}', 0.5), pg_temp.cat('Style & Soapbox', 10, '{}', 0.5),
   pg_temp.cat('Dirty Soles Welcome (Tech Boot)', 20, '{}', 0.5), pg_temp.cat('Video Fantasy', 10, '{}', 0.5)),
   jsonb_build_array(pg_temp.step(1)))),

(null, 'curated', 'Washington State Leather (WSLO)',
 '70% to win. WSLO excludes one randomly drawn judge per category; this template drops the high and low instead, which can differ. '
 || 'The categories published total 115 per judge, but the WSLO scoring protocol says 130; check for a missing category before using.',
 pg_temp.rubric('drop_high_low', 70, false, 'total', jsonb_build_array(
   pg_temp.cat('Social Interactions', 15), pg_temp.cat('Interview', 40), pg_temp.cat('Washington Image', 15),
   pg_temp.cat('Cruise-Bar Wear', 15), pg_temp.cat('Pop Question', 15), pg_temp.cat('Leather Image', 15)))),

(null, 'curated', 'Washington State Bootblack (WSLO)',
 '150 points per judge plus the Community Choice token vote (0–5, entered once; tied contestants split the points). 70% to win. '
 || 'WSLO excludes one randomly drawn judge per category; this template drops the high and low instead, which can differ. Speech is 2 minutes; add the overtime deduction amount on the Speech category.',
 pg_temp.rubric('drop_high_low', 70, false, 'total', jsonb_build_array(
   pg_temp.cat('Social Interactions', 15), pg_temp.cat('Interview', 30), pg_temp.cat('Technical Boot Shine & Boot Interview', 30),
   pg_temp.cat('Community Choice', 5, '{"scored_by": "producer"}', 0.01), pg_temp.cat('Washington Image', 15),
   pg_temp.cat('Cruise-Bar Wear', 15), pg_temp.cat('Pop Question', 15), pg_temp.cat('Formal Leather Image', 15), pg_temp.cat('Speech', 15)))),

(null, 'curated', 'Mr. Michigan Leather',
 'Interview 100, Bar/Cruise Wear 40, Pop & Personality 60, Full Leather & 90-second Speech 100 (300 per judge). A lone contestant needs 80% to win. The rules don''t say how many judges or whether high and low are dropped; every judge counts here.',
 pg_temp.rubric('sum', 80, true, 'total', jsonb_build_array(
   pg_temp.cat('Interview', 100), pg_temp.cat('Bar / Cruise Wear', 40), pg_temp.cat('Pop & Personality', 60),
   pg_temp.cat('Full Leather & 90-Second Speech', 100)))),

(null, 'curated', 'Maryland Leather',
 'Weighted categories scored out of their weight: Private Interview 30, Community Service 20, Filth Round 15, Formal Leather Image 15, Speech 20 (reads as a %). A lone contestant needs 80% to win. The rules don''t say how many judges or whether high and low are dropped; every judge counts here.',
 pg_temp.rubric('sum', 80, true, 'average', jsonb_build_array(
   pg_temp.cat('Private Interview', 30, '{}', 0.5), pg_temp.cat('Community Service', 20, '{}', 0.5), pg_temp.cat('Filth Round', 15, '{}', 0.5),
   pg_temp.cat('Formal Leather: Leather Image', 15, '{}', 0.5), pg_temp.cat('Formal Leather: Speech', 20, '{}', 0.5)))),

(null, 'curated', 'Northwest Person of Leather',
 '7 judges; each category drops its high and low; reported as the average per judge (500 possible). 70% (350) to win.',
 pg_temp.rubric('drop_high_low', 70, false, 'average', jsonb_build_array(
   pg_temp.cat('Interview', 150), pg_temp.cat('Two-Minute Speech', 100), pg_temp.cat('Ten-Minute Educational Presentation', 100),
   pg_temp.cat('Pop Question', 75), pg_temp.cat('Leather Lifestyle', 75)))),

(null, 'curated', 'Northwest Bootblack',
 '3 judges, every score counts; reported as the average per judge (500 possible). 70% (350) to win.',
 pg_temp.rubric('sum', 70, false, 'average', jsonb_build_array(
   pg_temp.cat('Bootblack Skills: Technical Ability', 100), pg_temp.cat('Bootblack Skills: Chair Management', 50),
   pg_temp.cat('Interview', 100), pg_temp.cat('Two-Minute Speech', 100), pg_temp.cat('Ten-Minute Educational Presentation', 50),
   pg_temp.cat('Pop Question', 50), pg_temp.cat('Overall Image & Personality', 50)))),

(null, 'curated', 'San Francisco Bootblack (2023)',
 '3 judges, every score counts. Speech & Formal Wear 100, Personal Interview 100, Tech Boot & Presentation 100, Pop Question 75, Stand Time 75, Demeanor & Interpersonal Skills 50 (500 per judge). '
 || 'The tally master deducts for speeches over two minutes; the amount isn''t published, so set it on the Speech category. No minimum or tiebreak is published.',
 pg_temp.rubric('sum', null, false, 'total', jsonb_build_array(
   pg_temp.cat('Speech & Formal Wear', 100), pg_temp.cat('Personal Interview', 100), pg_temp.cat('Tech Boot & Presentation', 100),
   pg_temp.cat('Pop Question', 75), pg_temp.cat('Stand Time', 75), pg_temp.cat('Demeanor & Interpersonal Skills', 50))));
