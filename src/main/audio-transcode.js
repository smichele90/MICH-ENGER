const { app } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked')

function tmpDir() {
  const dir = path.join(app.getPath('userData'), 'audio-tmp')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function runFfmpeg(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i', inputPath,
      '-vn',
      '-map_metadata', '-1',
      '-c:a', 'libopus',
      '-ac', '1',
      '-ar', '16000',
      '-b:a', '16k',
      '-application', 'voip',
      '-compression_level', '10',
      '-frame_duration', '20',
      '-packet_loss', '0',
      '-avoid_negative_ts', 'make_zero',
      '-fflags', '+bitexact',
      '-strict', 'experimental',
      '-f', 'ogg',
      outputPath
    ]
    const proc = spawn(ffmpegPath, args, { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', d => { stderr += d.toString() })
    proc.on('error', reject)
    proc.on('close', code => {
      if (code === 0) resolve(outputPath)
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-400)}`))
    })
  })
}

async function transcodeBufferToOgg(buffer) {
  const dir = tmpDir()
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const inputPath = path.join(dir, `in-${id}.bin`)
  const outputPath = path.join(dir, `out-${id}.ogg`)
  fs.writeFileSync(inputPath, buffer)
  try {
    await runFfmpeg(inputPath, outputPath)
    const out = fs.readFileSync(outputPath)
    return out
  } finally {
    try { fs.unlinkSync(inputPath) } catch {}
    try { fs.unlinkSync(outputPath) } catch {}
  }
}

async function transcodeFileToOgg(inputPath) {
  const dir = tmpDir()
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const outputPath = path.join(dir, `out-${id}.ogg`)
  await runFfmpeg(inputPath, outputPath)
  return outputPath
}

module.exports = { transcodeBufferToOgg, transcodeFileToOgg, ffmpegPath }
