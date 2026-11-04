import { Bloom, EffectComposer, N8AO, Outline, SMAA, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'

/**
 * Post-processing chain.
 *
 * High: ambient occlusion (the soft contact shadows of the clay look), the outline of the selected device,
 * bloom for emissive parts only (their colours are pushed above 1.0), ACES tone mapping and SMAA.
 * Low: tone mapping and SMAA only, for slower GPUs.
 * Tone mapping is an effect here because the composer renders to float buffers; the renderer's
 * own tone mapping is therefore disabled in SceneCanvas.
 * @param {{quality: 'high' | 'low'}} props
 */
export function PostFX({ quality }) {
  if (quality === 'low') {
    return (
      <EffectComposer key="low" multisampling={0}>
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <SMAA />
      </EffectComposer>
    )
  }
  return (
    <EffectComposer key="high" multisampling={0} enableNormalPass={false}>
      {/* Full-resolution AO on purpose: N8AO's half-resolution mode builds a multi-target polyfill
          that is incompatible with three r187 (see docs/STAGE1_ISSUES.md). */}
      <N8AO aoRadius={1.6} distanceFalloff={1.2} intensity={2.4} quality="medium" halfRes={false} />
      {/* The silhouette of the selected device (see DeviceNode: only a selected device is in the selection). */}
      <Outline blur edgeStrength={3.5} width={900} visibleEdgeColor={0x9fd0ff} hiddenEdgeColor={0x4da3ff} />
      <Bloom mipmapBlur luminanceThreshold={1.05} luminanceSmoothing={0.2} intensity={0.55} radius={0.7} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <SMAA />
    </EffectComposer>
  )
}
