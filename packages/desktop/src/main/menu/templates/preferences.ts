import type { MenuItemConstructorOptions } from 'electron'
import { userSetting } from '../actions/marktext'
import { t } from '../../i18n'
import type Keybindings from '../../keyboard/shortcutHandler'

export default function(keybindings: Keybindings): MenuItemConstructorOptions {
  return {
    id: 'preferencesMenuItem',
    label: t('menu.file.preferences'),
    accelerator: keybindings.getAccelerator('file.preferences') ?? undefined,
    click: userSetting
  }
}
