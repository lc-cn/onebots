import {h, onMounted, watch, nextTick, onBeforeUnmount} from 'vue'
import DefaultTheme from 'vitepress/theme'
import './custom.css'
import ElementUI from 'element-plus'
import {EnhanceAppContext, useRoute} from "vitepress";

// Dynamically imported to avoid SSR issues (window is not defined)
let svgPanZoom: ((svg: SVGElement | HTMLElement | string, options?: any) => any) | null = null

export default {
    extends:DefaultTheme,
    Layout:()=>h(DefaultTheme.Layout,null,{

    }),
    enhanceApp({app}:EnhanceAppContext){
        app.use(ElementUI)
    },
    setup() {
        const route = useRoute()
        
        // 灯箱相关逻辑
        const createLightbox = () => {
            if (document.querySelector('.mermaid-lightbox')) return
            
            const lightbox = document.createElement('div')
            lightbox.className = 'mermaid-lightbox'
            lightbox.innerHTML = `
                <div class="mermaid-lightbox-content"></div>
                <div class="mermaid-lightbox-close">×</div>
            `
            document.body.appendChild(lightbox)
            
            const closeLightbox = () => {
                lightbox.classList.remove('active')
                const content = lightbox.querySelector('.mermaid-lightbox-content')
                if (content) content.innerHTML = ''
            }
            
            lightbox.querySelector('.mermaid-lightbox-close')?.addEventListener('click', closeLightbox)
            lightbox.addEventListener('click', (e) => {
                if (e.target === lightbox) closeLightbox()
            })
            
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && lightbox.classList.contains('active')) {
                    closeLightbox()
                }
            })
        }

        const openLightbox = (originalSvg: SVGElement) => {
            const lightbox = document.querySelector('.mermaid-lightbox')
            const content = lightbox?.querySelector('.mermaid-lightbox-content')
            if (!lightbox || !content) return

            const clonedSvg = originalSvg.cloneNode(true) as SVGElement
            
            // 清理属性
            clonedSvg.removeAttribute('data-pan-zoom-initialized')
            clonedSvg.removeAttribute('style')
            clonedSvg.style.width = '100%'
            clonedSvg.style.height = '100%'
            
            // 移除旧控件
            clonedSvg.querySelector('#svg-pan-zoom-controls')?.remove()
            
            // 重置变换
            const viewport = clonedSvg.querySelector('.svg-pan-zoom_viewport')
            if (viewport) {
                viewport.setAttribute('transform', 'matrix(1,0,0,1,0,0)')
                viewport.removeAttribute('style')
            }

            content.innerHTML = ''
            content.appendChild(clonedSvg)
            lightbox.classList.add('active')
            
            // 延迟初始化灯箱内的 pan-zoom
            setTimeout(() => {
                try {
                    if (svgPanZoom) {
                    svgPanZoom(clonedSvg, {
                        zoomEnabled: true,
                        controlIconsEnabled: true,
                        fit: true,
                        center: true,
                        minZoom: 0.1,
                        maxZoom: 20
                    })
                    }
                } catch (e) {
                    console.warn('Lightbox pan-zoom init failed', e)
                }
            }, 50)
        }

        const initSvg = (svg: SVGElement) => {
            if (svg.getAttribute('data-pan-zoom-initialized')) return
            
            // 检查 SVG 是否有内容（Mermaid 渲染完成）
            if (!svg.querySelector('g')) return 

            const container = svg.parentElement
            if (!container) return

            // 动态高度
            const viewBox = svg.getAttribute('viewBox')
            if (viewBox) {
                const [x, y, w, h] = viewBox.split(' ').map(parseFloat)
                if (w && h) {
                    const aspectRatio = h / w
                    const containerWidth = container.clientWidth || 800
                    let targetHeight = containerWidth * aspectRatio
                    targetHeight = Math.max(400, Math.min(targetHeight, 900))
                    container.style.height = `${targetHeight}px`
                }
            }

            // 全屏按钮
            if (!container.querySelector('.mermaid-fullscreen-btn')) {
                const btn = document.createElement('div')
                btn.className = 'mermaid-fullscreen-btn'
                btn.title = '全屏查看'
                btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>`
                btn.onclick = () => openLightbox(svg)
                container.appendChild(btn)
            }

            // 初始化 pan-zoom
            if (!svgPanZoom) return
            try {
                if (svgPanZoom) {
                svgPanZoom(svg, {
                    zoomEnabled: true,
                    controlIconsEnabled: true,
                    fit: true,
                    center: true,
                    minZoom: 0.1,
                    maxZoom: 10,
                    zoomScaleSensitivity: 0.3
                })
                svg.setAttribute('data-pan-zoom-initialized', 'true')
                }
            } catch (e) {
                // 忽略初始化错误（可能是 SVG 还没准备好）
            }
        }

        const checkAll = () => {
            document.querySelectorAll('.mermaid svg').forEach((el) => initSvg(el as SVGElement))
        }

        onMounted(async () => {
            // Dynamically import svg-pan-zoom only on client side
            const module = await import('svg-pan-zoom')
            svgPanZoom = module.default
            
            createLightbox()
            
            // 立即检查
            checkAll()
            
            // 轮询检查（最稳妥的方式应对各种异步加载）
            const interval = setInterval(checkAll, 500)
            
            // 监听 DOM 变化
            const observer = new MutationObserver(() => checkAll())
            observer.observe(document.body, { childList: true, subtree: true })
            
            onBeforeUnmount(() => {
                clearInterval(interval)
                observer.disconnect()
            })
        })

        watch(() => route.path, () => {
            nextTick(() => setTimeout(checkAll, 100))
        })
    }
}
