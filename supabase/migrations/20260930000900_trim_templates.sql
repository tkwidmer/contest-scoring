-- Keep official templates to the contests the platform supports directly; the others were reference examples.
delete from public.templates
 where visibility = 'curated'
   and name in ('Washington State Leather (WSLO)', 'Washington State Bootblack (WSLO)', 'Mr. Michigan Leather',
                'Maryland Leather', 'Northwest Person of Leather', 'Northwest Bootblack');
