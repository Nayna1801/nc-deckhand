"""Comprobación rápida de deckforge (selftest): catálogo, reglas, simulador y red de cartas."""
from collections import Counter

import cardgraph as CG
import cardsdb as DB
import net_model as NM
import engine2 as X
import tests2
import tests_cards
import tests_choices
from deckio import HERE, deck_to_text, ids_of, load_deck, rows_of, text_to_deck
from forge_basic import deck_report
from forge_sim import build_side


def cmd_selftest(a):
    print('1) catálogo:', len(DB.RAW), 'cartas')
    d = load_deck(HERE / 'decks' / 'green_blue_judy.json')
    errs, ram = deck_report(d)
    assert not errs, errs
    print('2) mazo de ejemplo legal, RAM', dict(ram))
    sc = NM.score_deck(d['legends'], Counter(ids_of(d['main'])))
    print('3) puntuación de la red:', round(sc, 1))
    t = deck_to_text(d)
    d2, problems = text_to_deck(t)
    assert not problems and d2['main'] == d['main'] and d2['legends'] == d['legends'], problems
    print('4) exportar -> importar texto: idéntico')
    da, la = build_side(d)
    w, _ = X.play(da, la, da, la, N=20, seed=1)
    assert sum(w) == 20
    print('5) simulador: 20 partidas en espejo ->', w)
    print('6) reglas del motor:', tests2.run(), 'pruebas superadas')
    print('7) cartas una a una:', tests_cards.run(), 'grupos de pruebas superados')
    print('7b) cartas donde decide la persona:', tests_choices.run(), 'pruebas superadas')
    G = CG.Graph()
    nd = G.nodes
    assert 'PAIR' in nd['hanako_arasaka_daughter_of_the_emperor']['need'] and 'LOWCRED' in nd['towerfall']['need']
    assert 'GEAR' not in nd['maman_brigitte_spirit_of_death']['need'], 'unequipped no es equipped'
    assert 'vs_GEAR' in nd['detonate']['ctr'] and 'vs_GS' in nd['riot_shield']['ctr'] and 'MIN' in nd['trust_no_one']['give']
    assert G.path('wakako_okada_peace_and_harmony', 'towerfall') is not None
    wah = ['wakako_okada_peace_and_harmony', 'alt_cunningham_soulkiller_architect', 'hanako_arasaka_daughter_of_the_emperor']
    built = G.build(wah)
    errs, _ = DB.validate(wah, rows_of(built))
    assert not errs, errs
    print('8) red de cartas:', len(nd), 'nodos; mazo montado por la red legal')
    print('OK')
    return 0
