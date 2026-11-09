# RED de sinergias: anotación de TODAS las cartas (lo que producen / necesitan / contrarrestan / a qué son vulnerables)
# Formato por línea:  id | bonus_o_valor | produce | necesita | contrarresta | vulnerable
#  - Unidades: valor = fórmula(poder, coste) + bonus.  Gear/Programa/Legend: valor = el número tal cual (0-10).
#  - listas "FEATURE:peso,FEATURE:peso"   '-' = ninguna
# FEATURES: MIN PAIR LOW HIGH G8 EVEN ODD PROG BD GEAR BLK SPENT FUP CALL GS ADR ARA MERC POW P8 BODY TRASHP TRASHU QMANA EDDIE DRAW
# CONTRA (lo que contrarresta): SWEEP(vs LOWP) KSPENT(vs ATKR) SPENDBLK(vs BLKD) GEARHATE(vs GEARD) NOGS(vs GSD) BIGK(vs BIG) CUT1(vs ATKR) CREDX(vs CRED) FORCE
RAW_NET = """
# ---------------- AZUL: Unidades ----------------
evelyn_parker_scheming_siren|1.5|-|HIGH:2|-|-
jacked_in_voodoo_boy|-1.5|-|PROG:2|-|-
delamain_rideshare_ai|3.5|-|-|-|-
misty_olszewski_mender_of_broken_spirits|2.0|EDDIE:1,TRASHU:1|-|-|-
mox_inciters|1.0|BLK:1|-|FORCE:2|-
delamain_cab|0.5|EDDIE:1|-|-|-
hacked_corpo|1.5|TRASHP:2|PROG:1|-|-
psycho_squad|0|-|-|-|-
rita_wheeler_no_stupid_questions|1.0|BLK:1|-|-|-
westbrook_netrunner|1.0|-|-|NOGS:1|-
lizzy_wizzy_delicate_weapon|2.0|BLK:1|PROG:2,TRASHP:2|-|-
maman_brigitte_spirit_of_death|1.0|-|PROG:2|BIGK:1|-
modded_muramasa|0|-|LOW:2|-|-
mt0d12_flathead|0.5|-|LOW:2|-|-
rogue_amendiares_queen_of_the_afterlife|0.5|EDDIE:1|-|-|-
judy_alvarez_nothing_to_doubt|0|-|-|-|-
modded_kusanagi|-2.0|-|-|-|GSD
placide_voodoo_sentinel|2.0|-|PROG:2|BIGK:2|-
# ---------------- AZUL: Gear ----------------
tetratronic_rippler|2.5|GEAR:1,TRASHP:1|-|-|-
dying_night_v_s_pistol|4.0|GEAR:1,MIN:2,POW:1,LOW:1|-|-|-
netwatch_netdriver|3.5|GEAR:1,DRAW:1|-|-|-
# ---------------- AZUL: Programas ----------------
floor_it|5.0|PROG:1,QMANA:0|QMANA:1|-|-
trust_no_one|4.0|PROG:1,BD:1,MIN:3,LOW:3|-|-|-
reboot_optics|3.5|PROG:1|QMANA:1|-|-
three_mouths_one_desire|4.5|PROG:1,BD:1|MIN:2|-|-
chrome_reverie|4.0|PROG:1,BD:1,CALL:1|MIN:1|NOGS:1|-
nocturne_op55_n1|4.5|PROG:1,ARA:1|GS:1|-|-
pyramid_song|4.0|PROG:1,BD:1|MIN:1|BIGK:1|-
unlikely_bond|3.0|PROG:1|-|KSPENT:1|-
les_elemens|5.0|PROG:1|-|BIGK:1|-
towerfall|7.0|PROG:1,BD:1|LOW:3|SWEEP:3|-
# ---------------- VERDE: Unidades ----------------
corpo_security|1.5|BLK:1,ARA:1|-|-|-
tyger_s_whisper|1.5|CALL:1|-|-|-
emergency_atlus|0.5|-|-|-|-
field_operator|1.0|ARA:1|EVEN:1|-|-
maxtac_squadron|1.0|QMANA:2|FUP:1|-|-
valentino_street_racer|3.5|ADR:2|BODY:2|-|-
goro_takemura_losing_his_way|1.5|ARA:1|FUP:3|-|-
maelstrom_zealots|-1.5|-|-|-|-
pacifica_netrunner|1.0|SPENT:1|EVEN:1|-|-
pepe_najarro_working_doubles|0.5|QMANA:1|PAIR:2|-|-
maxtac_av|1.5|LOW:1,PAIR:1|-|CREDX:2|-
riding_nomad|0|-|-|-|GSD
wraith_marauders|0.5|-|-|-|-
nadia_fighting_through_grief|1.0|-|-|-|-
panam_palmer_strength_through_family|2.0|CALL:2|FUP:2|-|-
maxtac_heavy|3.0|-|-|-|-
sandayu_oda_hanako_s_guardian|2.0|SPENT:2|PAIR:3|SPENDBLK:2|-
saul_bright_stormrider|2.0|POW:3,RDY:2|P8:1|BIGK:0|-
# ---------------- VERDE: Gear ----------------
riot_shield|3.5|GEAR:1,BLK:2|-|NOGS:3|-
sandevistan|3.5|GEAR:1,RDY:2|-|-|-
overwatch_panam_s_gift|6.5|GEAR:1,POW:2|SPENT:3|KSPENT:3|GEARD
zetatech_berserk|2.5|GEAR:1|FUP:3|-|-
# ---------------- VERDE: Programas ----------------
peace_offering|4.5|PROG:1,BD:1,PAIR:3,LOW:1|-|CREDX:1|-
synapse_burnout|2.5|PROG:1|FUP:2,QMANA:1|-|-
corporate_surveillance|6.0|PROG:1,SPENT:3|-|SPENDBLK:3|-
fool_on_the_hill|4.0|PROG:1,DRAW:1|-|-|-
take_control|6.0|PROG:1|QMANA:1|CUT1:3|-
memory_relapse|6.0|PROG:1,BD:1,SPENT:3|EVEN:1|SPENDBLK:3|-
we_gotta_live_together|5.0|PROG:1|TRASHU:3|-|-
wild_in_the_streets|7.0|PROG:1|SPENT:3|KSPENT:3|-
don_t_fear_the_reaper|7.5|PROG:1,SPENT:4|-|SPENDBLK:4,KSPENT:3|-
# ---------------- ROJO: Unidades ----------------
japantown_jonin|0.5|POW:2|P8:2|-|-
ruthless_lowlife|-1.0|-|-|-|-
la_llorona_ghost_of_the_past|1.5|BLK:1,G8:2|-|-|-
swordwise_huscle|1.0|DRAW:1|POW:1|-|-
valentino_guerrera|0.5|-|HIGH:2|SPENDBLK:2|-
6th_street_recruits|1.0|G8:1|-|-|-
kerry_eurodyne_the_last_rockerboy|1.5|DRAW:1|G8:3|-|-
meredith_stout_stone_cold_corpo|1.5|BLK:1,ARA:1|-|-|-
chrome_fang|1.5|-|-|CUT1:2|-
el_sombreron_la_venganza_lenta|0|-|G8:1|-|-
royce_don_t_call_me_simon|2.5|-|HIGH:2|KSPENT:0|-
screw_lovelorn_fool|1.0|TRASHU:2|-|-|-
v_roamer_of_the_badlands|1.0|G8:2|-|-|-
animals_wrecker|1.0|P8:0|-|-|-
johnny_silverhand_never_stop_fighting|1.0|-|-|-|-
minotaur|1.5|-|HIGH:2|BIGK:1|-
octant|0|-|G8:3|-|-
yorinobu_arasaka_steel_dragon|2.0|ARA:2|-|-|-
# ---------------- ROJO: Gear / Programas ----------------
mantis_blades|5.0|GEAR:1,POW:2|-|-|GEARD
arasaka_emergency_radioport|3.0|GEAR:1,ARA:1,CALL:1|-|-|-
satori_sword_of_saburo|4.0|GEAR:1,POW:2,ARA:1|-|-|-
deadman_transmitter|3.0|GEAR:1|-|-|-
all_is_lost|3.0|PROG:1,TRASHP:1|-|-|-
detonate|2.5|PROG:1|-|GEARHATE:3|-
industrial_assembly|3.5|PROG:1,BD:1,ARA:1,G8:3|-|-|-
appetite_for_destruction|2.0|PROG:1|-|-|-
bonnie_and_clyde|6.0|PROG:1,BD:1|-|-|-
over_the_edge|3.0|PROG:1|-|-|-
gunpoint_diplomacy|2.5|PROG:1|SPENT:0|SPENDBLK:2|-
shattered_memories|2.5|PROG:1,BD:1|-|-|-
carnage_at_the_colosseum|4.0|PROG:1,BD:1|G8:3|BIGK:2|-
# ---------------- AMARILLO: Unidades ----------------
secondhand_bombus|0.5|BLK:1|-|-|-
sketchy_ripper|1.5|GEAR:1|-|-|-
augmented_negotiators|2.0|BLK:1,ARA:1|-|-|-
dexter_deshawn_one_last_chance|1.5|MIN:1,PAIR:1|HIGH:0|-|-
maelstrom_goons|1.0|-|GEAR:2|-|-
viktor_vektor_you_might_feel_a_little_pinch|1.5|GEAR:2|TRASHP:0|-|-
gilded_maton|1.0|-|GEAR:2|-|-
hanako_arasaka_in_a_gilded_cage|2.0|ARA:1|PAIR:1|-|-
offduty_malfini|2.0|SPENT:2|-|SPENDBLK:2|-
t_bug_amateur_philosopher|1.5|CALL:2|-|-|-
caliber_totentanz_s_top_dog|2.0|-|-|-|-
maxtac_suppression_team|2.0|-|-|NOGS:4|-
rockn_rockerboy|0|-|-|-|-
viktor_vektor_drop_your_illusions|1.0|-|GEAR:3|-|-
heywood_ripperdoc|1.5|-|-|GEARHATE:3|-
jackie_welles_ride_or_die_choom|1.0|-|EVEN:3,ODD:2|-|-
trauma_team_operatives|2.5|-|TRASHU:3|-|-
alt_cunningham_mother_of_daemons|1.5|-|GEAR:2|CUT1:2|-
adam_smasher_metal_over_meat|-0.5|-|-|-|-
# ---------------- AMARILLO: Gear / Programas ----------------
kiroshi_optics|1.5|GEAR:1,POW:1|-|-|GEARD
mandibular_upgrade|4.0|GEAR:1,BLK:2|-|-|GEARD
adrenaline_converter|2.5|GEAR:1,ADR:1,POW:2|-|-|GEARD
zetatech_faceplate|3.5|GEAR:1,POW:2,PAIR:1,MIN:1|-|-|GEARD
gorilla_arms|4.5|GEAR:1,POW:2|-|-|GEARD
the_relic_experimental_biochip|3.0|GEAR:1,POW:2|TRASHU:2|-|-
afterparty_at_lizzie_s|4.0|PROG:1,BD:1,PAIR:1,MIN:1|-|-|-
safety_override|4.0|PROG:1|QMANA:1|-|-
the_heist|3.5|PROG:1,TRASHP:1|GEAR:0|-|-
cyberpsychosis|3.0|PROG:1|GEAR:3|-|-
live_with_the_aftermath|2.5|PROG:1|-|-|-
bootleg_black_sapphire_show|3.0|PROG:1,BD:1,EDDIE:1|EVEN:1,ODD:1|-|-
# ---------------- LEGENDS (valor = utilidad propia; produce / necesita) ----------------
alt_cunningham_soulkiller_architect|7.0|PROG:0|MIN:4,PROG:4,TRASHP:3|-|-
evelyn_parker_beautiful_enigma|3.0|EDDIE:1|ARA:0|FORCE:2|-
jackie_welles_pour_one_out_for_me|6.0|MIN:5,LOW:4|BLUE:3|-|-
judy_alvarez_braindance_maestro|6.5|TRASHP:2,POW:1|BD:4,PROG:3|-|-
lucyna_kushinada_fresh_beginnings|3.5|CALL:1|MIN:2|-|-
wakako_okada_peace_and_harmony|4.5|MIN:4,LOW:3|FUP:1|-|-
sasha_yakovleva_won_t_let_you_down|5.0|GS:2,DRAW:2|-|-|-
v_corporate_exile|6.0|GS:3|-|-|-
goro_takemura_vengeful_bodyguard|5.5|BLK:2|BLK:3,PAIR:1|-|-
hanako_arasaka_daughter_of_the_emperor|7.0|PAIR:4,DRAW:3,LOW:3|PAIR:5,SPENT:0|CREDX:3|-
padre_man_of_the_cross|4.5|PAIR:3,SPENT:2,LOW:1|-|CREDX:2|-
panam_palmer_nomad_cavalry|3.5|RDY:2|GEAR:3|-|-
saburo_arasaka_stubborn_patriarch|4.0|POW:2|ARA:3|-|-
goro_takemura_hands_unclean|6.5|GS:3,BLK:1|-|-|-
jackie_welles_mama_s_favorite|6.0|GS:3|-|-|-
dexter_deshawn_off_the_grid|5.0|POW:3,G8:2,DRAW:1|-|-|-
johnny_silverhand_rocking_renegade|4.5|POW:2|G8:1|-|-
yorinobu_arasaka_embracing_destruction|3.5|DRAW:2|ARA:3,HIGH:2|-|-
v_streetkid|5.5|GS:3,TRASHP:1|BD:2|-|-
royce_psycho_on_the_edge|6.0|GS:3,POW:3|GEAR:3|-|-
adam_smasher_ender_of_legends|6.0|GS:3|-|BIGK:3|-
dum_dum_maelstrom_triggerman|5.5|DRAW:2,POW:2|GEAR:3|-|-
kerry_eurodyne_axe_attitude_audience|4.5|MIN:2,G8:2,DRAW:2|-|-|-
muamar_reyes_el_capitan|4.5|PAIR:2,MIN:2,LOW:1|-|-|-
river_ward_detective_on_the_hunt|7.0|GEAR:3,POW:1|GEAR:4|-|-
viktor_vektor_sit_down_and_relax|5.5|GEAR:3|GEAR:3|-|-
rogue_amendiares_preem_solo|4.5|GS:3|-|-|-
"""
