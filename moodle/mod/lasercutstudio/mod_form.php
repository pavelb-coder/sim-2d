<?php
// This file is part of Moodle - https://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <https://www.gnu.org/licenses/>.

/**
 * Settings form of the LaserCut Studio activity.
 *
 * @package    mod_lasercutstudio
 * @copyright  2026 LaserCut Studio
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

require_once($CFG->dirroot . '/course/moodleform_mod.php');

/**
 * Module settings form.
 */
// Имя класса задано ядром: course/modedit.php строит его как 'mod_' . $modname . '_mod_form'.
// Префикс mod_ здесь обязателен — в отличие от колбэков модуля в lib.php.
class mod_lasercutstudio_mod_form extends moodleform_mod {

    /**
     * Form definition.
     *
     * @return void
     */
    public function definition() {
        $mform = $this->_form;

        $mform->addElement('header', 'general', get_string('general', 'form'));

        $mform->addElement('text', 'name', get_string('name'), ['size' => '64']);
        $mform->setType('name', PARAM_TEXT);
        $mform->addRule('name', null, 'required', null, 'client');
        $mform->addRule('name', get_string('maximumchars', '', 255), 'maxlength', 255, 'client');

        $this->standard_intro_elements();

        $mform->addElement('header', 'editorsettings', get_string('editorsettings', 'mod_lasercutstudio'));

        $mform->addElement('text', 'editorheight', get_string('editorheight', 'mod_lasercutstudio'), ['size' => 6]);
        $mform->setType('editorheight', PARAM_INT);
        $mform->setDefault('editorheight', 640);
        $mform->addRule('editorheight', null, 'required', null, 'client');
        $mform->addRule('editorheight', null, 'numeric', null, 'client');
        $mform->addHelpButton('editorheight', 'editorheight', 'mod_lasercutstudio');

        $mform->addElement('advcheckbox', 'openinnewtab', get_string('openinnewtab', 'mod_lasercutstudio'));
        $mform->addHelpButton('openinnewtab', 'openinnewtab', 'mod_lasercutstudio');
        $mform->setDefault('openinnewtab', 0);

        $mform->addElement('header', 'gradeheader', get_string('grades', 'mod_lasercutstudio'));
        $mform->addElement('modgrade', 'grade', get_string('grades', 'mod_lasercutstudio'), false);
        $mform->addHelpButton('grade', 'grade', 'mod_lasercutstudio');
        $mform->setDefault('grade', 100);

        $this->standard_coursemodule_elements();
        $this->add_action_buttons();
    }

    /**
     * Prepares the form before it is displayed.
     *
     * @return void
     */
    public function definition_after_data() {
        parent::definition_after_data();
    }

    /**
     * Form validation.
     *
     * @param array $data
     * @param array $files
     * @return array
     */
    public function validation($data, $files) {
        $errors = parent::validation($data, $files);

        if (isset($data['editorheight'])) {
            $height = (int) $data['editorheight'];
            if ($height < 320 || $height > 2160) {
                $errors['editorheight'] = get_string('editorheighterror', 'mod_lasercutstudio');
            }
        }

        return $errors;
    }
}
