# Efectos que entiende el simulador (aproximaciones conservadoras de los textos reales)
# rem = {kind:'p'|'c', n, spent:bool, lowest:bool, sweep:bool, cond:'cred_gt'|'cred_lt'|'d20', plus, vs_mine}
R = lambda n, **k: dict(kind='p', n=n, **k)
RC = lambda n, **k: dict(kind='c', n=n, **k)

FX = {
    # ---------------- ROJO ----------------
    'royce_don_t_call_me_simon': dict(rem=R(2, plus=1)),                         # <=2 (<=3 con más Street Cred)
    'minotaur': dict(rem=R(5, cond='cred_gt')),                                  # solo con más Street Cred
    'bonnie_and_clyde': dict(rem=R(4), keep=8),
    'over_the_edge': dict(rem=R(0, cond='d20'), keep=6),                          # depende del d20 en tu zona de Gigs
    'carnage_at_the_colosseum': dict(rem=R(0, vs_mine=True), keep=7),
    'swordwise_huscle': dict(draw=0.5), 'kerry_eurodyne_the_last_rockerboy': dict(draw=0.5),
    'yorinobu_arasaka_steel_dragon': dict(free_unit=4),
    'la_llorona_ghost_of_the_past': dict(blocker=True), 'meredith_stout_stone_cold_corpo': dict(blocker=True),
    'ruthless_lowlife': dict(nogig=True), 'all_is_lost': dict(draw=0.8, keep=2), 'industrial_assembly': dict(draw=0.3, keep=2),
    'detonate': dict(keep=1), 'johnny_silverhand_never_stop_fighting': dict(),
    # ---------------- AMARILLO ----------------
    'caliber_totentanz_s_top_dog': dict(rem=RC(2)), 'offduty_malfini': dict(spend=True, spend_self=True),
    'augmented_negotiators': dict(blocker=True), 'secondhand_bombus': dict(blocker=True, nogig=True),
    'mandibular_upgrade': dict(blocker=True, keep=3), 'sketchy_ripper': dict(nogig=True, draw=0.5),
    'the_heist': dict(draw=0.8, keep=2), 'afterparty_at_lizzie_s': dict(keep=1),
    'trauma_team_operatives': dict(cost=5), 'gorilla_arms': dict(xsteal=True),
    # ---------------- VERDE ----------------
    'corporate_security': dict(blocker=True, noatk=True), 'corporate_surveillance': dict(spend=dict(cost_le=4), keep=7),
    'memory_relapse': dict(spend=dict(lock=True), keep=6), 'wild_in_the_streets': dict(rem=R(99, spent=True), keep=8),
    'don_t_fear_the_reaper': dict(rem=R(99, spent=True), spend_all=True, keep=9),
    'maxtac_heavy': dict(cost_rival=True), 'goro_takemura_losing_his_way': dict(lb=True), 'peace_offering': dict(keep=4),
    'riding_nomad': dict(adr=True), 'valentino_street_racer': dict(give_adr=True), 'nadia_fighting_through_grief': dict(adr_behind=True), 'jacked_in_voodoo_boy': dict(needs_prog=True), 'overwatch_panam_s_gift': dict(ow=True), 'riot_shield': dict(blocker=True), 'sandevistan': dict(vigil=True),
    'maelstrom_zealots': dict(nogig=True), 'tyger_s_whisper': dict(nogig=True), 'field_operator': dict(),
    'fool_on_the_hill': dict(draw=1, keep=4), 'we_gotta_live_together': dict(draw=1.2, keep=5), 'saul_bright_stormrider': dict(saul=True),
    'sandayu_oda_hanako_s_guardian': dict(),
    # ---------------- AZUL ----------------
    'delamain_rideshare_ai': dict(nogig=True, draw=2), 'floor_it': dict(draw=1, keep=2), 'trust_no_one': dict(keep=3), 'three_mouths_one_desire': dict(keep=4),
    'les_elemens': dict(rem=R(0, lowest=True), keep=7), 'towerfall': dict(rem=R(5, sweep=True, cond='cred_lt'), keep=9),
    'nocturne_op55_n1': dict(draw=2, keep=5), 'placide_voodoo_sentinel': dict(rem=R(99)),
    'mox_inciters': dict(blocker=True), 'rita_wheeler_no_stupid_questions': dict(blocker=True), 'lizzy_wizzy_delicate_weapon': dict(blocker=True, draw=1),
    'hacked_corpo': dict(draw=0.7), 'misty_olszewski_mender_of_broken_spirits': dict(noatk=True, draw=1),
    'evelyn_parker_scheming_siren': dict(nogig=True, draw=0.7), 'modded_kusanagi': dict(adr=True, bounce=True),
}

LEG = {
    'goro_takemura_hands_unclean': dict(gosolo=(5, 7)), 'jackie_welles_mama_s_favorite': dict(gosolo=(6, 8)),
    'v_corporate_exile': dict(gosolo=(5, 8)), 'sasha_yakovleva_won_t_let_you_down': dict(gosolo=(5, 5)),
    'v_streetkid': dict(gosolo=(5, 6)), 'royce_psycho_on_the_edge': dict(gosolo=(6, 8)),
    'adam_smasher_ender_of_legends': dict(gosolo=(9, 9), rem=R(99)), 'rogue_amendiares_preem_solo': dict(gosolo=(7, 7)),
    'dexter_deshawn_off_the_grid': dict(call_draw=1), 'dum_dum_maelstrom_triggerman': dict(call_draw=1),
    'lucyna_kushinada_fresh_beginnings': dict(call_draw=1.2), 'wakako_okada_peace_and_harmony': dict(call_draw=1),
    'muamar_reyes_el_capitan': dict(call_draw=1), 'padre_man_of_the_cross': dict(call_draw=1),
    'viktor_vektor_sit_down_and_relax': dict(call_draw=2), 'river_ward_detective_on_the_hunt': dict(free_gear=True),
    'jackie_welles_pour_one_out_for_me': dict(engine=True), 'hanako_arasaka_daughter_of_the_emperor': dict(engine=True),
    'alt_cunningham_soulkiller_architect': dict(engine=True), 'judy_alvarez_braindance_maestro': dict(engine=True),
}
