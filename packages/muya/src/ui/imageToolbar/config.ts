import middleIcon from '../../assets/icons/align_center/2.png';
import leftIcon from '../../assets/icons/align_left/2.png';
import rightIcon from '../../assets/icons/align_right/2.png';
import deleteIcon from '../../assets/icons/image_delete/2.png';
import editIcon from '../../assets/icons/imageEdit/2.png';
import inlineIcon from '../../assets/icons/inline_image/2.png';
import { isOsx, isWin } from '../../config/index';
import copyIcon from './icons/copy.svg?url';
import linkIcon from './icons/link.svg?url';
import revealIcon from './icons/reveal.svg?url';

export type TImageToolbarAction = 'open' | 'copy' | 'reveal' | 'inline' | 'left' | 'center' | 'right' | 'edit' | 'delete';

export interface IImageToolbarIcon {
    type: TImageToolbarAction;
    tooltip: string;
    icon: string;
    ariaLabel?: string;
}

const icons: IImageToolbarIcon[] = [
    {
        type: 'open',
        tooltip: 'Open Image in External Editor',
        ariaLabel: '用外部编辑器打开',
        icon: editIcon,
    },
    {
        type: 'copy',
        tooltip: 'Copy Image',
        ariaLabel: '复制图片',
        icon: copyIcon,
    },
    {
        type: 'reveal',
        tooltip: isOsx ? 'Show Image in Finder' : isWin ? 'Show Image in File Explorer' : 'Show Image in Folder',
        ariaLabel: isOsx ? '在 Finder 中显示' : isWin ? '在资源管理器中显示' : '在文件夹中显示',
        icon: revealIcon,
    },
    {
        type: 'inline',
        tooltip: 'Inline Image',
        icon: inlineIcon,
    },
    {
        type: 'left',
        tooltip: 'Align Left',
        icon: leftIcon,
    },
    {
        type: 'center',
        tooltip: 'Align Center',
        icon: middleIcon,
    },
    {
        type: 'right',
        tooltip: 'Align Right',
        icon: rightIcon,
    },
    {
        type: 'edit',
        tooltip: 'Insert or Replace Image',
        ariaLabel: '插入/更换图片',
        icon: linkIcon,
    },
    {
        type: 'delete',
        tooltip: 'Remove Image',
        icon: deleteIcon,
    },
];

export default icons;

export type Icon = IImageToolbarIcon;
