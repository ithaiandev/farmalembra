// =====================================================================
// Imagens das campanhas: reduzir, enviar ao Supabase Storage, apagar
// e atualizar a "capa" da prévia do link no WhatsApp.
// =====================================================================
import { supabase } from './supabase.js';

const PASTA = 'campanhas';
const LADO_MAXIMO = 1600;           // px — boa qualidade no WhatsApp e arquivo leve
const TAMANHO_MAXIMO_ORIGINAL = 15 * 1024 * 1024;

const TIPOS_ACEITOS = ['image/jpeg', 'image/png', 'image/webp'];
const LIMITE_STORAGE = 5 * 1024 * 1024; // igual ao limite da pasta no Supabase

/**
 * Prepara a imagem para enviar: reduz e converte para JPEG.
 * Se o aparelho não conseguir reduzir (ou demorar demais), usa a foto
 * original, desde que caiba no limite. Nunca fica travado.
 */
export async function prepararImagem(arquivo) {
  if (!arquivo.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem (JPG ou PNG).');
  if (arquivo.size > TAMANHO_MAXIMO_ORIGINAL) throw new Error('Imagem muito grande (máximo 15 MB).');

  const limite = new Promise((_, falha) => setTimeout(() => falha(new Error('tempo esgotado')), 10000));
  try {
    return await Promise.race([reduzir(arquivo), limite]);
  } catch (e) {
    console.warn('Não reduziu a imagem, usando a original:', e);
    if (TIPOS_ACEITOS.includes(arquivo.type) && arquivo.size <= LIMITE_STORAGE) return arquivo;
    throw new Error('Não foi possível preparar a imagem. Tente uma foto JPG ou PNG com até 5 MB.');
  }
}

/** Reduz (padrão: até 1600 px) e converte para JPEG (fundo branco no lugar de transparência) */
async function reduzir(arquivo, ladoMaximo = LADO_MAXIMO, qualidade = 0.85) {
  const bmp = await createImageBitmap(arquivo);
  const escala = Math.min(1, ladoMaximo / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * escala);
  const h = Math.round(bmp.height * escala);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();

  const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', qualidade));
  if (!blob) throw new Error('Não foi possível processar a imagem.');
  return new File([blob], 'promocao.jpg', { type: 'image/jpeg' });
}

/** Envia ao Storage e devolve o link público */
export async function enviarImagem(arquivo) {
  const ext = { 'image/png': 'png', 'image/webp': 'webp' }[arquivo.type] || 'jpg';
  const caminho = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(PASTA).upload(caminho, arquivo, {
    contentType: arquivo.type || 'image/jpeg', cacheControl: '31536000', upsert: false,
  });
  if (error) throw error;
  return supabase.storage.from(PASTA).getPublicUrl(caminho).data.publicUrl;
}

/** Apaga uma imagem pelo link público (ignora links que não são do nosso Storage) */
export async function removerImagem(url) {
  const marca = `/storage/v1/object/public/${PASTA}/`;
  const i = url ? url.indexOf(marca) : -1;
  if (i < 0) return;
  const caminho = decodeURIComponent(url.slice(i + marca.length));
  await supabase.storage.from(PASTA).remove([caminho]);
}

/**
 * Copia uma imagem do Storage para um arquivo novo e devolve o link da cópia.
 * Usado ao duplicar campanha: cada campanha fica com as suas imagens, então
 * excluir uma não apaga as fotos da outra. Links de fora do Storage voltam iguais.
 */
export async function copiarImagem(url) {
  const marca = `/storage/v1/object/public/${PASTA}/`;
  const i = url ? url.indexOf(marca) : -1;
  if (i < 0) return url;
  const origem = decodeURIComponent(url.slice(i + marca.length));
  const ext = (origem.match(/\.(\w+)$/) || [, 'jpg'])[1];
  const destino = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(PASTA).copy(origem, destino);
  if (error) throw error;
  return supabase.storage.from(PASTA).getPublicUrl(destino).data.publicUrl;
}

/**
 * Atualiza a "capa" usada na prévia do link no WhatsApp (arquivo campanhas/capa.jpg).
 * A página promo.html aponta para essa capa (og:image). A capa tem sempre
 * 1200×630 (formato da prévia GRANDE do WhatsApp): a foto inteira fica no
 * meio, com fundo branco nas sobras, e o arquivo fica leve.
 */
export const ARQUIVO_CAPA = 'capa.jpg';
const CAPA_LARGURA = 1200;
const CAPA_ALTURA = 630;

async function montarCapa(arquivo) {
  const bmp = await createImageBitmap(arquivo);
  const escala = Math.min(CAPA_LARGURA / bmp.width, CAPA_ALTURA / bmp.height);
  const w = Math.round(bmp.width * escala);
  const h = Math.round(bmp.height * escala);

  const canvas = document.createElement('canvas');
  canvas.width = CAPA_LARGURA;
  canvas.height = CAPA_ALTURA;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CAPA_LARGURA, CAPA_ALTURA);
  ctx.drawImage(bmp, Math.round((CAPA_LARGURA - w) / 2), Math.round((CAPA_ALTURA - h) / 2), w, h);
  bmp.close?.();

  const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.82));
  if (!blob) throw new Error('Não foi possível processar a imagem.');
  return new File([blob], ARQUIVO_CAPA, { type: 'image/jpeg' });
}

export async function atualizarCapa(urlImagem) {
  const original = await baixarComoArquivo(urlImagem);
  let capa;
  try {
    const limite = new Promise((_, falha) => setTimeout(() => falha(new Error('tempo')), 10000));
    capa = await Promise.race([montarCapa(original), limite]);
  } catch {
    capa = original.size <= 600 * 1024 ? original : null; // se não reduziu, só usa se já for leve
  }
  if (!capa) throw new Error('Imagem grande demais para a prévia.');
  const { error } = await supabase.storage.from(PASTA).upload(ARQUIVO_CAPA, capa, {
    contentType: capa.type || 'image/jpeg', cacheControl: '60', upsert: true,
  });
  if (error) throw error;
}

/** Baixa a imagem do link e devolve como File (para compartilhar) */
export async function baixarComoArquivo(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Não foi possível carregar a imagem.');
  const blob = await resp.blob();
  return new File([blob], 'promocao.jpg', { type: blob.type || 'image/jpeg' });
}

