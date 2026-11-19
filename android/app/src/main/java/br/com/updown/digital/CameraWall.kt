package br.com.updown.digital

import android.graphics.Color
import android.graphics.Matrix
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.TextureView
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.rtsp.RtspMediaSource
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.ceil
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Mosaico de CFTV: reproduz as câmeras (RTSP, padrão Intelbras/Dahua) direto da rede local,
 * por cima do player web. O vídeo não passa pelo servidor.
 *
 *  - layout 1, 4 (2×2), 9 (3×3) ou 16 (4×4); com mais câmeras que espaços, faz rodízio de páginas;
 *  - acompanha a orientação da TV (retrato/paisagem) definida no gerenciador;
 *  - reconecta sozinho quando uma câmera cai; informa o status de cada câmera ao painel.
 */
@OptIn(UnstableApi::class)
class CameraWall(private val activity: MainActivity, private val parent: FrameLayout) {

    private data class Cam(val id: Int, val name: String, val url: String)

    private class Cell(val cam: Cam, val view: FrameLayout, val texture: TextureView, val status: TextView) {
        var player: ExoPlayer? = null
        var state = "conectando"
        var error: String? = null
        var videoW = 0
        var videoH = 0
    }

    private val handler = Handler(Looper.getMainLooper())
    private var root: FrameLayout? = null
    private var rotor: FrameLayout? = null
    private var cells = mutableListOf<Cell>()
    private var cams = listOf<Cam>()
    private var slots = 4
    private var page = 0
    private var cycleMs = 0L
    private var rotation = 0
    private var marginPct = 0
    private var lastConfig = ""

    val isShowing get() = root != null

    fun show(json: String) {
        if (json == lastConfig && root != null) return
        lastConfig = json
        val cfg = JSONObject(json)
        val items = cfg.optJSONArray("items") ?: JSONArray()
        cams = (0 until items.length()).map { i ->
            val o = items.getJSONObject(i)
            Cam(o.optInt("id"), o.optString("name"), o.optString("url"))
        }.filter { it.url.startsWith("rtsp://") }
        slots = cfg.optInt("slots", 4).coerceIn(1, 16)
        cycleMs = cfg.optLong("cycle_seconds", 0L) * 1000
        rotation = cfg.optInt("rotation", 0)
        marginPct = cfg.optInt("safe_margin_percent", 0).coerceIn(0, 10)
        page = 0
        ensureRoot()
        renderPage()
    }

    fun hide() {
        handler.removeCallbacksAndMessages(null)
        releaseCells()
        root?.let { parent.removeView(it) }
        root = null
        rotor = null
        lastConfig = ""
    }

    /** Resumo para o painel, ex.: "3/4 ao vivo · Portaria: falha (sem resposta)". */
    fun status(): String {
        if (root == null) return ""
        val live = cells.count { it.state == "ao vivo" }
        val problems = cells.filter { it.state == "falha" }.joinToString(" · ") { "${it.cam.name}: falha (${it.error ?: "?"})" }
        val pages = if (pageCount() > 1) " · página ${page + 1}/${pageCount()}" else ""
        return "$live/${cells.size} ao vivo$pages" + (if (problems.isNotEmpty()) " · $problems" else "")
    }

    private fun pageCount() = maxOf(1, ceil(cams.size / slots.toDouble()).toInt())

    private fun ensureRoot() {
        if (root != null) return
        val r = FrameLayout(activity).apply { setBackgroundColor(Color.BLACK) }
        val inner = FrameLayout(activity)
        r.addView(inner)
        parent.addView(r, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        r.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> layoutRotor() }
        root = r
        rotor = inner
    }

    /** Gira e dimensiona o mosaico conforme a orientação e a margem de segurança. */
    private fun layoutRotor() {
        val r = root ?: return
        val inner = rotor ?: return
        val w = r.width
        val h = r.height
        if (w == 0 || h == 0) return
        val sideways = rotation == 90 || rotation == 270
        val m = 1 - 2 * marginPct / 100f
        val lw = ((if (sideways) h else w) * m).toInt()
        val lh = ((if (sideways) w else h) * m).toInt()
        val lp = inner.layoutParams as FrameLayout.LayoutParams
        if (lp.width != lw || lp.height != lh) {
            lp.width = lw
            lp.height = lh
            lp.gravity = Gravity.CENTER
            inner.layoutParams = lp
        }
        inner.rotation = rotation.toFloat()
    }

    private fun renderPage() {
        val inner = rotor ?: return
        handler.removeCallbacksAndMessages(null)
        releaseCells()
        inner.removeAllViews()
        val pageCams = cams.drop(page * slots).take(slots)
        val cols = ceil(sqrt(slots.toDouble())).toInt()
        val rows = ceil(slots / cols.toDouble()).toInt()
        val grid = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        inner.addView(grid, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        var idx = 0
        for (row in 0 until rows) {
            val line = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
            grid.addView(line, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
            for (col in 0 until cols) {
                val cellView = FrameLayout(activity).apply { setBackgroundColor(Color.rgb(10, 4, 40)); setPadding(2, 2, 2, 2) }
                line.addView(cellView, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
                val cam = pageCams.getOrNull(idx++) ?: continue
                cells.add(buildCell(cam, cellView, cols))
            }
        }
        layoutRotor()
        if (cycleMs > 0 && pageCount() > 1) {
            handler.postDelayed({ page = (page + 1) % pageCount(); renderPage() }, cycleMs)
        }
    }

    private fun buildCell(cam: Cam, cellView: FrameLayout, cols: Int): Cell {
        val texture = TextureView(activity)
        cellView.addView(texture, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        val textSize = when (cols) { 1 -> 22f; 2 -> 16f; 3 -> 13f; else -> 11f }
        val label = TextView(activity).apply {
            text = cam.name
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, textSize)
            setBackgroundColor(Color.argb(150, 20, 0, 88))
            setPadding(12, 4, 12, 4)
        }
        cellView.addView(label, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.START))
        val status = TextView(activity).apply {
            setTextColor(Color.rgb(0, 206, 255))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, textSize)
            gravity = Gravity.CENTER
            text = "Conectando…"
        }
        cellView.addView(status, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        val cell = Cell(cam, cellView, texture, status)
        texture.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> fitVideo(cell) }
        start(cell)
        return cell
    }

    private fun start(cell: Cell) {
        cell.player?.release()
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(500, 2_000, 250, 500)  // baixa latência para imagem ao vivo
            .build()
        val player = ExoPlayer.Builder(activity).setLoadControl(loadControl).build()
        player.volume = 0f
        player.setVideoTextureView(cell.texture)
        val source = RtspMediaSource.Factory()
            .setForceUseRtpTcp(true)   // mais estável em Wi-Fi e através de roteadores
            .setTimeoutMs(10_000)
            .createMediaSource(MediaItem.fromUri(Uri.parse(cell.cam.url)))
        player.setMediaSource(source)
        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY) {
                    cell.state = "ao vivo"; cell.error = null; cell.status.visibility = View.GONE
                } else if (state == Player.STATE_BUFFERING && cell.state != "ao vivo") {
                    cell.status.text = "Conectando…"; cell.status.visibility = View.VISIBLE
                } else if (state == Player.STATE_ENDED) {
                    retry(cell, "transmissão encerrada")
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                val msg = when {
                    error.message?.contains("401") == true -> "usuário/senha"
                    error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ||
                        error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> "sem resposta"
                    error.errorCode == PlaybackException.ERROR_CODE_DECODER_INIT_FAILED ||
                        error.errorCode == PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED -> "codec não suportado"
                    else -> error.errorCodeName.removePrefix("ERROR_CODE_").lowercase()
                }
                retry(cell, msg)
            }

            override fun onVideoSizeChanged(size: VideoSize) {
                cell.videoW = (size.width * size.pixelWidthHeightRatio).toInt()
                cell.videoH = size.height
                fitVideo(cell)
            }
        })
        player.playWhenReady = true
        player.prepare()
        cell.player = player
        cell.state = "conectando"
    }

    private fun retry(cell: Cell, reason: String) {
        cell.state = "falha"
        cell.error = reason
        cell.status.text = "${cell.cam.name}: $reason\nTentando novamente…"
        cell.status.visibility = View.VISIBLE
        handler.postDelayed({ if (cells.contains(cell)) start(cell) }, 5_000)
    }

    /** Mantém a proporção do vídeo dentro do quadro (sem distorcer). */
    private fun fitVideo(cell: Cell) {
        val vw = cell.videoW.toFloat()
        val vh = cell.videoH.toFloat()
        val w = cell.texture.width.toFloat()
        val h = cell.texture.height.toFloat()
        if (vw <= 0 || vh <= 0 || w <= 0 || h <= 0) return
        val scale = min(w / vw, h / vh)
        val m = Matrix()
        m.setScale(vw * scale / w, vh * scale / h, w / 2, h / 2)
        cell.texture.setTransform(m)
    }

    private fun releaseCells() {
        cells.forEach { it.player?.release(); it.player = null }
        cells.clear()
    }
}
