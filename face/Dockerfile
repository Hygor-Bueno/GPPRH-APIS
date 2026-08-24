# Reconhecimento facial do refeitório — etapa 6.
#
# Duas coisas guiam este Dockerfile:
#
#   1. **O modelo entra na imagem, no build.** O insightface baixa os modelos na
#      primeira execução, por padrão. Isso significaria que o container precisa de
#      internet para funcionar — e que um restart num momento sem rede deixaria o
#      refeitório sem reconhecimento. Baixar no build resolve: em produção o
#      processo sobe offline.
#
#   2. **Sem compilador na imagem final.** O insightface compila extensões C++ na
#      instalação. O build usa dois estágios para que o gcc e os headers fiquem no
#      primeiro e não viajem para produção.

# ─── Estágio 1: dependências e modelo ────────────────────────────────────────
FROM python:3.11-slim AS deps

# build-essential e cmake: exigidos pela compilação do insightface.
# libgl1 e libglib2.0-0: o opencv-headless ainda liga contra elas.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential cmake libgl1 libglib2.0-0 curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /install

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install/python -r requirements.txt

# Baixa o pacote de modelos AGORA, com rede disponível, para /models.
# buffalo_l = detecção SCRFD + reconhecimento w600k_r50, que devolve 512 float32
# — exatamente os 2048 bytes que CK_meal_biometric_embedding_size exige.
#
# Para trocar por buffalo_s (menor e mais rápido, menos preciso), mude o ARG e o
# FACE_MODEL_PACK do compose JUNTOS — e recadastre os rostos, porque o model_tag
# muda e vetores de modelos diferentes não se comparam.
ARG MODEL_PACK=buffalo_l
ENV PYTHONPATH=/install/python/lib/python3.11/site-packages

# ⚠️ `root='/models'` é PARÂMETRO, não variável de ambiente.
#
# O insightface 0.7.3 não lê `INSIGHTFACE_HOME`: o caminho vem do argumento `root`
# de FaceAnalysis, cujo default é `~/.insightface`. Usar a env var fez o download
# ir para /root/.insightface e o COPY abaixo trazer uma pasta vazia — container
# que subia, respondia /health, e falhava na primeira imagem.
#
# Este valor tem que ser IDÊNTICO ao FACE_MODEL_ROOT do app.py.
RUN mkdir -p /models \
 && python -c "\
from insightface.app import FaceAnalysis; \
a = FaceAnalysis(name='${MODEL_PACK}', root='/models', providers=['CPUExecutionProvider'], allowed_modules=['detection','recognition']); \
a.prepare(ctx_id=-1, det_size=(640,640)); \
print('modelo ${MODEL_PACK} baixado em /models')"

# Falha o build se o modelo não estiver onde o runtime vai procurar. Sem isto, o
# erro aparece semanas depois, na primeira foto de um colaborador.
RUN test -n "$(find /models -name '*.onnx' -print -quit)" \
 || (echo 'ERRO: nenhum .onnx em /models — o root do FaceAnalysis nao bateu' && exit 1)

# ─── Estágio 2: runtime ──────────────────────────────────────────────────────
FROM python:3.11-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps /install/python /usr/local
COPY --from=deps /models /models

ENV FACE_MODEL_ROOT=/models \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    # O insightface arrasta matplotlib, que quer escrever cache de fontes em
    # ~/.config. Com read_only: true isso falha, ele cai para um diretório
    # temporário novo a cada boot e regenera o fontManager — ~1,5s de startup
    # jogados fora, mais um aviso em todo log. Apontar para o tmpfs resolve.
    MPLCONFIGDIR=/tmp/matplotlib

WORKDIR /app
COPY app.py .

# Usuário sem privilégio. O serviço não escreve em disco em nenhum momento — não
# há motivo para o processo poder.
RUN useradd --create-home --shell /usr/sbin/nologin face \
 && chown -R face:face /app /models
USER face

EXPOSE 8000

# 2 workers: o reconhecimento é CPU-bound e sequencial por requisição. Mais
# workers em CPU compartilhada só aumentam a latência de cada um.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
