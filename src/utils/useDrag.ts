import { onBeforeUnmount, ref, type Ref } from 'vue'

type DragOptions = {
  moveDirection?: 'x' | 'y' | 'both'
  moveLimit?: number
}

export function useDrag(el: Ref<HTMLElement | null | undefined>,dragOptions: DragOptions = {moveDirection: 'both', moveLimit: 20}) {
  const moveDirection = dragOptions.moveDirection ?? 'both'
  const moveLimit = dragOptions.moveLimit ?? 20
  let startY = 0 // 记录鼠标按下时的Y坐标
  let startX = 0 // 记录鼠标按下时的X坐标

  const bottomPosition = ref(20)
  const rightPosition = ref(20)

  const isDragging = ref(false)
  const suppressNextClick = ref(false)

  const onPointerDown = (e: PointerEvent) => {
    if (!el.value) return
    isDragging.value = true
    startX = e.clientX
    startY = e.clientY

    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', cleanUp)
    document.addEventListener('pointercancel', cleanUp)

    e.preventDefault()
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!isDragging.value || !el.value) return

    if(moveDirection === 'y' || moveDirection === 'both') {
      const deltaY = e.clientY - startY
      bottomPosition.value -= deltaY
      const maxBottom = Math.max(moveLimit, window.innerHeight - el.value.offsetHeight - moveLimit)
      bottomPosition.value = Math.max(moveLimit, Math.min(bottomPosition.value, maxBottom))
      startY = e.clientY
    }
    if(moveDirection === 'x' || moveDirection === 'both') {
      const deltaX = e.clientX - startX
      rightPosition.value -= deltaX
      const maxRight = Math.max(moveLimit, window.innerWidth - el.value.offsetWidth - moveLimit)
      rightPosition.value = Math.max(moveLimit, Math.min(rightPosition.value, maxRight))
      startX = e.clientX
    }
    // 阻止下一次点击事件
    suppressNextClick.value = true
  }

  const cleanUp = () => {
    isDragging.value = false
    if (typeof document === 'undefined') return
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', cleanUp)
    document.removeEventListener('pointercancel', cleanUp)
  }

  onBeforeUnmount(()=>{
    cleanUp()
  })

  return {
    onPointerDown,
    bottomPosition,
    rightPosition,
    suppressNextClick
  }
}