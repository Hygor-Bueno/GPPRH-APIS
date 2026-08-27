"""
Serviço de reconhecimento facial do refeitório — etapa 6.

Faz duas coisas e nada mais:

    POST /embed    imagem  -> vetor de 512 float32 (cadastro)
    POST /verify   imagem + vetor de referência -> score de similaridade

O que ele deliberadamente NÃO faz:

  * **Não guarda nada.** Não há banco, não há disco, não há cache. A imagem
    chega em memória, é decodificada de um buffer em memória, e o processo
    devolve números. Nenhum `open()` de escrita existe neste arquivo.

  * **Não decide o limiar.** `/verify` devolve o score; quem compara com o corte
    é a API. O limiar não sai de paper — é calibrado no piloto, com as fotos da
    empresa, na iluminação do refeitório, com a câmera do aparelho. Embutir um
    número aqui seria fingir que essa medição já aconteceu.

  * **Não identifica 1:N.** Não existe rota que receba um rosto e procure quem é.
    A matrícula estreita para uma linha e o rosto só confirma. Identificar contra
    mil rostos degrada muito a acurácia, e falso positivo aqui é o sistema
    afirmar identidade errada sobre uma pessoa.

  * **Não loga imagem, nem vetor.** O log tem tamanho de payload, tempo e
    veredito. Vetor em log de aplicação é dado sensível em texto plano.

Rede: este serviço NÃO publica porta no host. Ele é alcançável apenas pela rede
interna do compose, pelo nome `face`. Não há como falar com ele de fora da
máquina, nem do próprio host.
"""

from __future__ import annotations

import base64
import logging
import os
import time
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

# ─── Configuração ────────────────────────────────────────────────────────────

MODEL_PACK = os.getenv("FACE_MODEL_PACK", "buffalo_l")

# ⚠️ Onde o modelo está, e por que isto é PARÂMETRO e não variável de ambiente.
#
# O insightface 0.7.3 NÃO lê `INSIGHTFACE_HOME`. O caminho vem do argumento `root`
# de `FaceAnalysis`, cujo default é `~/.insightface`. Confiar na env var custou um
# container que subia, respondia /health com 200, e só falhava na primeira imagem:
# o download do build tinha ido para /root/.insightface, o COPY trouxe uma pasta
# vazia, e em produção ele tentava baixar num sistema de arquivos read-only.
#
# O valor tem que ser IDÊNTICO ao usado no Dockerfile. Se divergirem, o sintoma é
# esse mesmo — saudável no health, quebrado no uso.
MODEL_ROOT = os.getenv("FACE_MODEL_ROOT", "/models")

# Identifica o modelo que gerou cada vetor. Vai para `meal_biometric.model_tag`,
# que é VARCHAR(40) — a coluna existe porque vetor de um modelo não compara com o
# de outro, e sem ela a acurácia cairia em silêncio numa troca de versão.
MODEL_TAG = os.getenv("FACE_MODEL_TAG", f"insightface-{MODEL_PACK}-w600k_r50")

# 512 float32. Bate com CK_meal_biometric_embedding_size = 2048 bytes.
EMBEDDING_DIM = 512
EMBEDDING_BYTES = EMBEDDING_DIM * 4

# Confiança mínima do DETECTOR (não do reconhecimento). Descarta borrão e rosto
# de fundo; não tem relação com o limiar de identidade.
#
# ⚠️ 0.55 está ACIMA do default do próprio insightface (0.50). É mais rígido de
# propósito, mas se aparecer muito "nenhum rosto nítido" com score entre 0.50 e
# 0.55 no log, é aqui que se afrouxa — e a mensagem de erro agora informa o
# score exato justamente para essa decisão sair de medição, não de palpite.
MIN_DET_SCORE = float(os.getenv("FACE_MIN_DET_SCORE", "0.55"))

# Tentar 90/180/270 graus quando nada é encontrado na orientação original.
#
# Ligado por padrão porque o custo cai só no caminho que já ia falhar. Desligue
# para diagnosticar: com isto em "0", uma imagem que só é reconhecida girada
# volta a falhar, e o log de aviso some — é o teste que confirma se a origem do
# problema é orientação no cliente.
TRY_ROTATIONS = os.getenv("FACE_TRY_ROTATIONS", "1") not in ("0", "false", "False")

# Teto do payload. Uma foto de rosto em JPEG cabe folgado em 4 MB; acima disso é
# erro de cliente ou tentativa de esgotar memória.
MAX_IMAGE_BYTES = int(os.getenv("FACE_MAX_IMAGE_BYTES", str(4 * 1024 * 1024)))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("face")

app = FastAPI(
    title="Refeitório — reconhecimento facial",
    description="Cadastro e verificação 1:1. Não armazena nada.",
    version="1.0.0",
)

_analyzer: Any = None


def analyzer() -> Any:
    """
    Carrega o modelo uma vez, na primeira requisição.

    Fora do import de propósito: o carregamento leva alguns segundos e alocaria
    memória mesmo num container que subiu só para o healthcheck responder.

    `providers=["CPUExecutionProvider"]` é explícito para o ONNX Runtime não
    tentar CUDA e derrubar o processo num servidor sem GPU — falha que aparece
    como erro de inicialização obscuro em vez de "não há GPU aqui".
    """
    global _analyzer
    if _analyzer is None:
        from insightface.app import FaceAnalysis

        started = time.perf_counter()
        instance = FaceAnalysis(
            name=MODEL_PACK,
            root=MODEL_ROOT,
            providers=["CPUExecutionProvider"],
            allowed_modules=["detection", "recognition"],
        )
        instance.prepare(ctx_id=-1, det_size=(640, 640))
        _analyzer = instance
        log.info(
            "modelo carregado pack=%s tag=%s em %.1fs",
            MODEL_PACK,
            MODEL_TAG,
            time.perf_counter() - started,
        )
    return _analyzer


# ─── Contratos ───────────────────────────────────────────────────────────────


class EmbedRequest(BaseModel):
    """Imagem em base64. JPEG ou PNG."""

    image: str = Field(..., description="Imagem em base64, sem prefixo data:")


class EmbedResponse(BaseModel):
    embedding: str = Field(..., description="512 float32 little-endian, em base64")
    model_tag: str
    det_score: float = Field(..., description="Confiança do DETECTOR, não do reconhecimento")
    bbox: list[int]


class VerifyRequest(BaseModel):
    image: str = Field(..., description="Imagem em base64 de quem está no balcão")
    reference: str = Field(..., description="Vetor guardado, em base64")
    model_tag: str = Field(
        ...,
        description=(
            "model_tag gravado junto do vetor de referência. Comparar vetores de "
            "modelos diferentes devolve número sem significado, então a "
            "divergência é erro, não aviso."
        ),
    )


class VerifyResponse(BaseModel):
    score: float = Field(..., description="Similaridade de cosseno, -1 a 1")
    model_tag: str
    det_score: float
    # Deliberadamente NÃO existe campo `match`. Quem decide é a API, com o limiar
    # calibrado no piloto.


# ─── Núcleo ──────────────────────────────────────────────────────────────────


def decode_image(image_b64: str) -> np.ndarray:
    """
    Decodifica a imagem inteiramente em memória.

    `cv2.imdecode` sobre um buffer numpy, nunca `cv2.imread` de caminho: não há
    arquivo temporário em nenhum momento, que é a promessa de "as imagens são
    descartadas sem tocar disco" do documento de LGPD.
    """
    import cv2

    try:
        raw = base64.b64decode(image_b64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Imagem não é base64 válido.")

    if not raw:
        raise HTTPException(status_code=400, detail="Imagem vazia.")

    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Imagem acima de {MAX_IMAGE_BYTES} bytes.",
        )

    buffer = np.frombuffer(raw, dtype=np.uint8)
    frame = cv2.imdecode(buffer, cv2.IMREAD_COLOR)

    if frame is None:
        raise HTTPException(status_code=400, detail="Não foi possível decodificar a imagem.")

    return frame


def _detect(frame: np.ndarray) -> tuple[list, float]:
    """
    Roda o detector e devolve (rostos utilizáveis, melhor score visto).

    O melhor score sai junto mesmo quando ninguém passou do corte, e é o dado
    que faltava: sem ele, "não achei rosto nenhum" e "achei um rosto a 0,41,
    logo abaixo do corte de 0,55" produzem a MESMA mensagem, e são diagnósticos
    opostos — o primeiro é imagem girada ou corrompida, o segundo é
    enquadramento, distância ou luz.

    @private
    """
    faces = analyzer().get(frame)
    usable = [f for f in faces if float(f.det_score) >= MIN_DET_SCORE]
    best = max((float(f.det_score) for f in faces), default=0.0)
    return usable, best


def single_face(frame: np.ndarray) -> Any:
    """
    Exige exatamente um rosto utilizável.

    Duas recusas, cada uma por um motivo concreto:

    Nenhum rosto -> a foto não serve, e dizer isso é melhor que devolver vetor de
    coisa nenhuma.

    Mais de um rosto -> **não escolhe o maior.** No cadastro, pegar o rosto
    errado grava a pessoa errada de forma permanente e silenciosa; na
    verificação, aceita a refeição de quem estava atrás na fila. Escolher por
    área funciona quase sempre, e "quase sempre" aqui significa gravar
    biometria de alguém que não consentiu.

    ── A tentativa com a imagem girada ─────────────────────────────────────────

    Quando NADA é encontrado na orientação original, tenta 90, 180 e 270 graus
    antes de desistir. Isso existe por um sintoma concreto: cadastro feito num
    aparelho funcionava, e o mesmo rosto no aparelho ao lado falhava com "nenhum
    rosto nítido" — erro de DETECÇÃO, não de comparação, ou seja, o vetor
    guardado nem chegava a ser usado.

    A causa provável é orientação EXIF: parte dos aparelhos grava a rotação como
    tag de metadado em vez de girar os pixels, e `cv2.imdecode` (diferente de
    `cv2.imread`) trata EXIF de forma que varia com a versão do OpenCV. Com o
    rosto deitado 90 graus o RetinaFace não acha nada — ele tolera uns 30 graus
    de inclinação, não um quarto de volta.

    Tentar as rotações resolve o sintoma sem depender de descobrir QUAL das
    causas é, e sem dependência nova para ler EXIF. O custo cai inteiro no
    caminho que já ia falhar: na orientação certa, o primeiro `_detect` acerta e
    nenhuma rotação roda. As mesmas duas regras acima continuam valendo sobre a
    imagem girada — girar não muda quem é a pessoa nem quantas pessoas há.
    """
    usable, best = _detect(frame)
    rotation = 0

    if not usable and TRY_ROTATIONS:
        for turns in (1, 2, 3):
            rotated_usable, rotated_best = _detect(np.rot90(frame, turns).copy())
            best = max(best, rotated_best)

            if rotated_usable:
                usable = rotated_usable
                rotation = turns * 90
                log.warning(
                    "rosto so encontrado apos girar %d graus — provavel orientacao "
                    "EXIF nao aplicada pelo aparelho de origem",
                    rotation,
                )
                break

    if not usable:
        # O score entra na mensagem: e a diferenca entre "nao ha rosto aqui" e
        # "ha um rosto, so nao nitido o bastante".
        log.info("sem rosto utilizavel best_det_score=%.3f corte=%.2f", best, MIN_DET_SCORE)
        raise HTTPException(
            status_code=422,
            detail=(
                f"Nenhum rosto nítido na imagem (melhor detecção: {best:.2f}, "
                f"mínimo: {MIN_DET_SCORE:.2f}). Aproxime o rosto e melhore a luz."
            ),
        )

    if len(usable) > 1:
        raise HTTPException(
            status_code=422,
            detail=(
                f"{len(usable)} rostos na imagem. Enquadre apenas a pessoa que vai "
                "ser servida — o sistema não escolhe por você."
            ),
        )

    return usable[0]


def normalized_embedding(face: Any) -> np.ndarray:
    """
    Vetor normalizado (norma 1), float32.

    Normalizar aqui e não na comparação torna o `/verify` um produto escalar
    simples, e — mais importante — garante que todo vetor GRAVADO já está
    normalizado. Vetores com normas diferentes no banco produziriam scores
    incomparáveis entre si sem nenhum sintoma visível.
    """
    vector = np.asarray(face.normed_embedding, dtype=np.float32)

    if vector.shape != (EMBEDDING_DIM,):
        raise HTTPException(
            status_code=500,
            detail=f"Modelo devolveu vetor de {vector.shape}, esperado ({EMBEDDING_DIM},).",
        )

    return vector


def decode_reference(reference_b64: str) -> np.ndarray:
    raw = base64.b64decode(reference_b64, validate=True)

    if len(raw) != EMBEDDING_BYTES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Vetor de referência tem {len(raw)} bytes, esperado {EMBEDDING_BYTES}. "
                "Vetor truncado compara mal em vez de falhar — por isso falha aqui."
            ),
        )

    return np.frombuffer(raw, dtype="<f4").copy()


# ─── Rotas ───────────────────────────────────────────────────────────────────


@app.get("/health")
def health() -> dict[str, Any]:
    """
    Sonda de container.

    Reporta se os ARQUIVOS do modelo estão no lugar, e não só se o processo subiu.
    Um /health que responde 200 sem olhar o disco foi exatamente o que escondeu a
    falha do `root` errado: o container parecia saudável e quebrava na primeira
    imagem. Sonda que não checa a dependência crítica não é sonda.
    """
    model_dir = os.path.join(MODEL_ROOT, "models", MODEL_PACK)
    files = []
    if os.path.isdir(model_dir):
        files = sorted(f for f in os.listdir(model_dir) if f.endswith(".onnx"))

    return {
        "status": "ok" if files else "degraded",
        "model_tag": MODEL_TAG,
        "model_root": MODEL_ROOT,
        "model_files": files,
        "model_present": bool(files),
        "model_loaded": _analyzer is not None,
        "embedding_bytes": EMBEDDING_BYTES,
    }


@app.post("/embed", response_model=EmbedResponse)
def embed(request: EmbedRequest) -> EmbedResponse:
    """
    Gera o vetor de cadastro.

    Chamado pelo autocadastro por link. O vetor devolvido é o que vai para
    `meal_biometric.embedding`; a imagem morre aqui.
    """
    started = time.perf_counter()
    frame = decode_image(request.image)
    face = single_face(frame)
    vector = normalized_embedding(face)

    log.info(
        "embed ok det_score=%.3f ms=%.0f",
        float(face.det_score),
        (time.perf_counter() - started) * 1000,
    )

    return EmbedResponse(
        embedding=base64.b64encode(vector.tobytes()).decode("ascii"),
        model_tag=MODEL_TAG,
        det_score=round(float(face.det_score), 4),
        bbox=[int(v) for v in face.bbox],
    )


@app.post("/verify", response_model=VerifyResponse)
def verify(request: VerifyRequest) -> VerifyResponse:
    """
    Compara 1:1 e devolve o score. Não decide nada.

    A divergência de `model_tag` é erro e não aviso: comparar vetor de modelos
    diferentes devolve um número que parece score e não é. Um sistema que
    aceitasse isso com um warning no log degradaria a acurácia sem sintoma.
    """
    if request.model_tag != MODEL_TAG:
        raise HTTPException(
            status_code=409,
            detail=(
                f"O vetor guardado é do modelo '{request.model_tag}' e este serviço "
                f"roda '{MODEL_TAG}'. Vetores de modelos diferentes não se comparam. "
                "Recadastre o rosto ou volte o serviço para o modelo anterior."
            ),
        )

    started = time.perf_counter()
    reference = decode_reference(request.reference)
    frame = decode_image(request.image)
    face = single_face(frame)
    probe = normalized_embedding(face)

    # Ambos normalizados, então o produto escalar É a similaridade de cosseno.
    score = float(np.dot(probe, reference))

    log.info(
        "verify score=%.4f det_score=%.3f ms=%.0f",
        score,
        float(face.det_score),
        (time.perf_counter() - started) * 1000,
    )

    return VerifyResponse(
        score=round(score, 6),
        model_tag=MODEL_TAG,
        det_score=round(float(face.det_score), 4),
    )
