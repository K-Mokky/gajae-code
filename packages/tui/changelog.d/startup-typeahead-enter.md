### Fixed

- A prompt typed while gjc is still starting up now submits when Enter is pressed. The terminal is still in cooked mode at that point, which turns Enter into a line feed that the editor read as Shift+Enter, so the prompt only gained a new line.
