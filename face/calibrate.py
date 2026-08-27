"""
Calibração do limiar — o entregável real da etapa 6.

O plano é explícito: o piloto não deve entregar uma tela funcionando, deve
entregar **um número**. Este script é o que produz esse número.

    O limiar não sai do paper: é calibrado com as suas fotos, na sua iluminação,
    com a sua câmera.

O que ele faz: lê uma pasta de fotos rotuladas por pessoa, gera os vetores,
compara TODOS os pares possíveis e imprime, para cada limiar candidato, a taxa de
falso aceite e a de falso rejeite. O corte certo sai da tabela, não de um chute.

--------------------------------------------------------------------------------
POR QUE ISTO NÃO TOCA PRODUÇÃO
--------------------------------------------------------------------------------
Nenhuma linha de `meal_biometric` é lida ou escrita. Nenhum convite é emitido.
Nenhuma refeição é registrada. O script não fala com o SQL Server — ele só lê
arquivos de uma pasta e imprime números.

Isso importa para a ordem das coisas: a autorização organizacional assinada
(etapa 0) trava **cadastrar as mil pessoas em produção**. O piloto precisa de
consentimento por escrito dos 15 a 20 voluntários, e das fotos apagadas ao fim.
Ver `docs/refeitorio-lgpd-piloto-consentimento.md`.

⚠️ As fotos do piloto SÃO dado biométrico enquanto existirem. Apague a pasta
   quando a tabela estiver impressa. O script não apaga por você de propósito:
   apagar dado de terceiro sem ninguém mandar é o tipo de conveniência que
   destrói a evidência antes de alguém conferir.

--------------------------------------------------------------------------------
COMO USAR
--------------------------------------------------------------------------------
Organize as fotos em uma pasta por pessoa. O nome da pasta é o rótulo — use
apelido ou código, não matrícula: o nome do arquivo não precisa identificar
ninguém para a medição funcionar.

    piloto/
      voluntario-01/  foto1.jpg foto2.jpg foto3.jpg ...
      voluntario-02/  ...

Cada pessoa precisa de **pelo menos 2 fotos** — uma comparação de uma pessoa com
ela mesma exige duas capturas diferentes. Quanto mais variação de luz e ângulo,
mais honesto o número.

    docker compose run --rm \\
      -v /caminho/do/piloto:/piloto:ro \\
      face python /app/calibrate.py /piloto

O `:ro` é deliberado: o container não tem por que poder alterar as fotos.
"""

from __future__ import annotations

import os
import sys
from itertools import combinations
from pathlib import Path

import numpy as np

MODEL_PACK = os.getenv("FACE_MODEL_PACK", "buffalo_l")
MODEL_ROOT = os.getenv("FACE_MODEL_ROOT", "/models")
MODEL_TAG = os.getenv("FACE_MODEL_TAG", f"insightface-{MODEL_PACK}-w600k_r50")
MIN_DET_SCORE = float(os.getenv("FACE_MIN_DET_SCORE", "0.55"))

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}

# Limiares avaliados. A faixa cobre de permissivo a muito restritivo; o corte
# usável em ArcFace normalmente cai entre 0,30 e 0,55, mas imprimir os extremos
# mostra a forma da curva — e é a forma que diz se a separação é boa.
THRESHOLDS = [round(0.20 + 0.025 * i, 3) for i in range(15)]


def load_analyzer():
    from insightface.app import FaceAnalysis

    analyzer = FaceAnalysis(
        name=MODEL_PACK,
        root=MODEL_ROOT,
        providers=["CPUExecutionProvider"],
        allowed_modules=["detection", "recognition"],
    )
    analyzer.prepare(ctx_id=-1, det_size=(640, 640))
    return analyzer


def embed_folder(analyzer, root: Path) -> dict[str, list[np.ndarray]]:
    """
    Gera os vetores, uma lista por pessoa.

    Foto com zero ou mais de um rosto é DESCARTADA e reportada, nunca corrigida
    por heurística. Escolher "o rosto maior" aqui contaminaria a medição com o
    rosto errado, e o número resultante pareceria bom.
    """
    import cv2

    vectors: dict[str, list[np.ndarray]] = {}
    skipped: list[tuple[str, str]] = []

    for person_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        label = person_dir.name
        vectors[label] = []

        for image_path in sorted(person_dir.iterdir()):
            if image_path.suffix.lower() not in IMAGE_SUFFIXES:
                continue

            frame = cv2.imread(str(image_path))
            if frame is None:
                skipped.append((str(image_path), "não é imagem legível"))
                continue

            faces = [f for f in analyzer.get(frame) if float(f.det_score) >= MIN_DET_SCORE]

            if len(faces) != 1:
                skipped.append((
                    str(image_path),
                    f"{len(faces)} rostos detectados — precisa ser exatamente 1",
                ))
                continue

            vectors[label].append(np.asarray(faces[0].normed_embedding, dtype=np.float32))

    if skipped:
        print("\nFotos descartadas:")
        for path, reason in skipped:
            print(f"  {path}: {reason}")

    return {label: items for label, items in vectors.items() if items}


def score_pairs(vectors: dict[str, list[np.ndarray]]):
    """
    Todos os pares.

    `genuine` = duas fotos da MESMA pessoa. `impostor` = fotos de pessoas
    diferentes. Os dois conjuntos são o que permite medir os dois erros — com só
    um deles, dá para provar qualquer limiar.
    """
    genuine: list[float] = []
    impostor: list[float] = []

    for label, items in vectors.items():
        for a, b in combinations(items, 2):
            genuine.append(float(np.dot(a, b)))

    labels = sorted(vectors)
    for label_a, label_b in combinations(labels, 2):
        for a in vectors[label_a]:
            for b in vectors[label_b]:
                impostor.append(float(np.dot(a, b)))

    return genuine, impostor


def describe(name: str, scores: list[float]) -> None:
    if not scores:
        print(f"  {name}: nenhum par")
        return

    array = np.asarray(scores)
    print(
        f"  {name}: n={len(scores)} "
        f"min={array.min():.4f} p05={np.percentile(array, 5):.4f} "
        f"mediana={np.median(array):.4f} "
        f"p95={np.percentile(array, 95):.4f} max={array.max():.4f}"
    )


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2

    root = Path(argv[1])
    if not root.is_dir():
        print(f"Pasta não encontrada: {root}")
        return 2

    print(f"Modelo: {MODEL_TAG}")
    print(f"Pasta:  {root}")

    analyzer = load_analyzer()
    vectors = embed_folder(analyzer, root)

    if len(vectors) < 2:
        print(
            "\nPreciso de pelo menos DUAS pessoas com foto aproveitável. "
            "Sem impostor não há falso aceite para medir, e o limiar sairia "
            "escolhido para nunca recusar ninguém."
        )
        return 1

    print("\nVetores por pessoa:")
    for label, items in sorted(vectors.items()):
        print(f"  {label}: {len(items)}")

    singles = [label for label, items in vectors.items() if len(items) < 2]
    if singles:
        print(
            "\n⚠️ Sem par genuíno (só 1 foto aproveitável): "
            + ", ".join(singles)
            + "\n   Essas pessoas entram só no cálculo de falso aceite."
        )

    genuine, impostor = score_pairs(vectors)

    print("\nDistribuição dos scores:")
    describe("mesma pessoa   ", genuine)
    describe("pessoas difer. ", impostor)

    if not genuine:
        print(
            "\nNenhum par da mesma pessoa. Cada voluntário precisa de pelo menos "
            "duas fotos aproveitáveis — sem isso não há falso rejeite para medir."
        )
        return 1

    genuine_array = np.asarray(genuine)
    impostor_array = np.asarray(impostor)

    print("\n" + "=" * 72)
    print("limiar   falso rejeite        falso aceite         observação")
    print("-" * 72)

    best = None

    for threshold in THRESHOLDS:
        # Falso rejeite: a pessoa é ela mesma e o sistema recusou.
        frr = float((genuine_array < threshold).mean())
        # Falso aceite: são pessoas diferentes e o sistema aceitou.
        far = float((impostor_array >= threshold).mean())

        note = ""
        if far == 0.0 and (best is None or threshold < best[0]):
            best = (threshold, frr, far)
            note = "<- menor limiar com zero falso aceite"

        print(
            f"{threshold:6.3f}   {frr * 100:6.2f}% ({int((genuine_array < threshold).sum()):4d})  "
            f"   {far * 100:6.2f}% ({int((impostor_array >= threshold).sum()):4d})   {note}"
        )

    print("=" * 72)

    if best:
        threshold, frr, _ = best
        print(
            f"\nSugestão: MEAL_FACE_THRESHOLD={threshold:.3f}\n"
            f"  Zero falso aceite nesta amostra, com {frr * 100:.2f}% de falso rejeite.\n"
        )
    else:
        print(
            "\nNENHUM limiar testado zerou o falso aceite nesta amostra.\n"
            "  Isso não é falha do script — é a medição dizendo que estas fotos não\n"
            "  separam as pessoas. Antes de subir o limiar, olhe a qualidade das\n"
            "  capturas: luz de cima, contraluz e rosto pequeno no quadro derrubam a\n"
            "  separação mais que qualquer ajuste de corte.\n"
        )

    print(
        "Como ler isto:\n"
        "  Falso aceite é o erro grave — o sistema afirmando identidade errada\n"
        "  sobre uma pessoa. Ele não tem desfazer.\n"
        "  Falso rejeite é incômodo: a pessoa serve pelo crachá, como todos já\n"
        "  fazem hoje.\n"
        "  Por isso a escolha certa é o MENOR limiar com zero falso aceite, e não\n"
        "  o que minimiza a soma dos dois erros.\n"
        "\n"
        "  Amostra pequena não prova zero: com 20 voluntários o falso aceite\n"
        "  medido é 0% ou nada — não existe 0,1% em 190 pares. Trate a sugestão\n"
        "  como piso, não como garantia.\n"
        "\n"
        "⚠️ Apague a pasta de fotos agora que a tabela está impressa."
    )

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
