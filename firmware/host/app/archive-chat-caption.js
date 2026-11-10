// Reserve the top of the 320x240 face screen for speech captions.
// SimpleFace starts at y=60 and the speaker controls occupy the bottom edge.
// Keep captions out of the animated mouth and both speaker-strip heights.
export const CHAT_CAPTION_LAYOUT = Object.freeze({
  top: 8,
  height: 24,
  paddingY: 4,
})

export function showChatCaption(robot, text, holdMs = 5000) {
  robot.showBalloon(text, { ...CHAT_CAPTION_LAYOUT, holdMs })
}
