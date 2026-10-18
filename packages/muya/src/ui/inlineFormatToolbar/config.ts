import { isOsx } from '../../config';

const COMMAND_KEY = isOsx ? '⌘' : 'Ctrl';

const icons = [
    {
        type: 'strong',
        tooltip: 'Emphasize',
        shortcut: `${COMMAND_KEY}+B`,
    },
    {
        type: 'em',
        tooltip: 'Italic',
        shortcut: `${COMMAND_KEY}+I`,
    },
    {
        type: 'u',
        tooltip: 'Underline',
        shortcut: `${COMMAND_KEY}+U`,
    },
    {
        type: 'del',
        tooltip: 'Strikethrough',
        shortcut: `${COMMAND_KEY}+D`,
    },
    {
        type: 'mark',
        tooltip: 'Highlight',
        shortcut: `⇧+${COMMAND_KEY}+H`,
    },
    {
        type: 'inline_code',
        tooltip: 'Inline Code',
        // Default keybinding is Cmd/Ctrl+` (Linux uses Ctrl+Y); was wrongly +E.
        shortcut: `${COMMAND_KEY}+\``,
    },
    {
        type: 'inline_math',
        tooltip: 'Inline Math',
        // Default keybinding is Shift+Cmd/Ctrl+M; was wrongly +E.
        shortcut: `⇧+${COMMAND_KEY}+M`,
    },
    {
        type: 'sup',
        tooltip: '上标',
        shortcut: '',
    },
    {
        type: 'sub',
        tooltip: '下标',
        shortcut: '',
    },
    {
        type: 'link',
        tooltip: '插入链接',
        shortcut: `${COMMAND_KEY}+L`,
    },
    {
        type: 'clear',
        tooltip: '清除文本格式',
        shortcut: `⇧+${COMMAND_KEY}+R`,
    },
];

export type FormatToolIcon = typeof icons[number];

export default icons;
