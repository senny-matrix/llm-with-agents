import React from "react";
import { Box, Text } from "ink";

export function Logo() {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="magentaBright" bold>
          ╭───╮ ╭───╮ ╭───╮
        </Text>
      </Box>
      <Box>
        <Text color="magentaBright" bold>
          │▀▀▀│ │▀▀▀│ │▀▀▀│
        </Text>
      </Box>
      <Box>
        <Text color="magentaBright" bold>
          │▄▄▄│ │▄▄▄│ │▄▄▄│
        </Text>
      </Box>
      <Box>
        <Text color="magentaBright" bold>
          ╰───╯ ╰───╯ ╰───╯
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color="cyan" dimColor>
          MicroSkills Studio — AGI v2
        </Text>
      </Box>
      <Box>
        <Text color="cyan" dimColor>
          Designed &amp; Developed by Rogers Aaron &lt;rogers@microskills.ac.tz&gt;
        </Text>
      </Box>
      <Box>
        <Text color="cyan" dimColor>
          for MicroSkills IT Services
        </Text>
      </Box>
    </Box>
  );
}
