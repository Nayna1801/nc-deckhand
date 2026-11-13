"""Comprobación de que el motor y el piloto dan EXACTAMENTE los mismos resultados que la referencia guardada en golden/.

Sirve para cambiar código sin cambiar el juego: tras tocar el motor (engine2, fx2_*) o el piloto (ai2_*), esto debe decir «todo igual».
Si el cambio de comportamiento ES lo que se busca, se revisa la diferencia y se guarda la nueva referencia.

    python tools/deckforge/golden.py             compara (siete comandos, ~1 min)
    python tools/deckforge/golden.py --update    guarda la salida actual como nueva referencia
    python tools/deckforge/golden.py --show      enseña la diferencia de los casos que cambian

Cada caso va con semilla fija; se quitan los tiempos («[12s]», «3,4 s»), que es lo único que cambia entre ejecuciones.
"""
import difflib
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
GOLDEN = HERE / 'golden'
D = 'decks/mejor_goro_wakako_v.json'
J = 'decks/bbg_jackie_alt_hanako.json'
CASES = {
    'gauntlet_fast': ['gauntlet', D, '--fast', '--games', '200', '--seed', '7'],
    'gauntlet_deep': ['gauntlet', D, '--games', '24', '--seed', '7'],
    'gauntlet_err': ['gauntlet', D, '--fast', '--games', '150', '--seed', '7', '--err', '0.2', '--err-rival', '0.1'],
    'sim_deep': ['sim', D, J, '--games', '24', '--seed', '3'],
    'explain': ['explain', D, '--fast', '--games', '60', '--seed', '7'],
    'score': ['score', D],
    'graph_deck': ['graph', 'deck', D],
}
_TIME = [re.compile(r'\[\d+s\]'), re.compile(r'\d+(\.\d+)? ?s\b')]


def run(args):
    env = dict(os.environ, PYTHONIOENCODING='utf-8')
    r = subprocess.run([sys.executable, '-I', 'forge.py', *args], cwd=HERE, capture_output=True, text=True, encoding='utf-8', errors='replace', env=env)
    text = r.stdout + r.stderr
    for rx in _TIME:
        text = rx.sub('', text)
    return text.splitlines()


def main():
    update, show = '--update' in sys.argv, '--show' in sys.argv
    GOLDEN.mkdir(exist_ok=True)
    changed = []
    for name, args in CASES.items():
        now = run(args)
        path = GOLDEN / f'{name}.txt'
        if update:
            path.write_text('\n'.join(now) + '\n', encoding='utf-8', newline='\n')
            continue
        ref = path.read_text(encoding='utf-8').splitlines() if path.exists() else None
        if ref != now:
            changed.append(name)
            print(f'DISTINTO {name}' + ('' if ref is not None else ' (no hay referencia: usa --update)'))
            if show and ref is not None:
                print('\n'.join(list(difflib.unified_diff(ref, now, 'referencia', 'ahora', lineterm=''))[:40]))
    if update:
        print(f'{len(CASES)} referencias guardadas en {GOLDEN}')
        return 0
    print('todo igual' if not changed else f'{len(changed)} casos distintos: {", ".join(changed)}')
    return 1 if changed else 0


if __name__ == '__main__':
    sys.exit(main())
