A IA agora roda dentro do app, sem Ollama. Como ficou:

O que o LocalStudio faz, e o que eu copiei
A análise do projeto confirmou o palpite: o LocalStudio usa @huggingface/transformers com device: 'webgpu' e dtype: 'q4', dentro de Web Workers ES module, com os pesos no cache do navegador. Nada de Ollama, nada de servidor de inferência. E o detalhe que importava: ele é um app web servido por HTTP, não por file:// — e isso não é coincidência, é requisito. WebGPU exige contexto seguro, e worker de módulo exige origem real.

Por isso o primeiro passo aqui foi trocar a origem da janela. O app não carrega mais com loadFile; agora tem um esquema próprio, vault-app://, registrado como standard + secure + supportFetchAPI, servindo os arquivos do diretório do app. Isso destrava WebGPU, worker de módulo e Cache API de uma vez. Como efeito colateral bom, os workers do Monaco também passam a funcionar de verdade, o que antes provavelmente caía no modo sem worker.

O handler tem checagem de travessia de caminho, e eu testei: ..%2f..%2fetc%2fpasswd dá 403, e as variantes que o URL normaliza ficam contidas dentro do diretório do app. Também verifiquei que cada recurso que a página pede resolve com o MIME certo, incluindo os .wasm do ONNX Runtime.

O motor
Dois arquivos novos. llm-worker.js é o worker de módulo que importa o build web do transformers direto do node_modules e roda o pipeline. local-llm.js é a ponte com a UI, com protocolo de requisição por id, igual ao padrão do LocalStudio.

Três decisões que valem explicar:

O q4f16 depende de shader-f16, e sem esse recurso o carregamento estoura no meio. Então o worker consulta o adaptador antes e escolhe a quantização: q4f16 quando a GPU suporta, q4 quando não, e cai para WASM na CPU se não houver WebGPU nenhum.

O runtime ONNX é servido pelo próprio app, não por CDN. Apontei wasmPaths para node_modules/onnxruntime-web/dist/, que tem tanto o .mjs quanto o .wasm — o diretório do transformers só traz o .mjs, o que daria 404. Conferi que as versões batem exatamente (1.26.0-dev.20260416), senão o wasm recusa carregar.

Threads de WASM ficaram desligadas de propósito. Elas exigem SharedArrayBuffer, que exige os cabeçalhos COOP/COEP, e require-corp atrapalharia o download dos pesos do Hugging Face. Não vale o risco pelo ganho.

Ao contrário do LocalStudio, aqui tem streaming token a token via TextStreamer, porque a UI de chat já era preparada para isso. E o botão de enviar vira um botão vermelho de parar durante a geração, usando InterruptableStoppingCriteria.

Os modelos
Consultei a API do Hugging Face para os tamanhos reais, em vez de estimar:

Modelo	Download	Observação
Qwen2.5 0.5B
~470 MB
roda até sem GPU
Qwen3 0.6B
~590 MB
padrão
Llama 3.2 1B
~1,0 GB
quer GPU
Qwen2.5 1.5B
~1,2 GB
o mais capaz
Gemma 4 E2B
~1,5 GB
o mesmo do LocalStudio
Baixa uma vez, fica na Cache API sob a chave vault-llm-v1. O progresso aparece na própria bolha do chat enquanto baixa. Nas configurações, "Onde a IA roda" agora tem no app (WebGPU) como primeira opção, e Ollama, openai-compat e openrouter continuam lá para quem quiser modelo grande. Trocar de modelo descarrega o anterior, porque dois pesos na memória não caberiam.

O que preciso que você teste
Não consigo abrir janela daqui — o sandbox bloqueia o socket do X, e não há Xvfb. Então a migração para vault-app:// e o carregamento do modelo são as duas coisas que só a sua máquina confirma. Se o npm start subir com a janela normal e os botões respondendo, a migração de origem passou. Depois, em Configurações → IA / LLM, o botão Checar GPU diz se o WebGPU apareceu e se tem shader-f16, antes de você gastar 590 MB de download.