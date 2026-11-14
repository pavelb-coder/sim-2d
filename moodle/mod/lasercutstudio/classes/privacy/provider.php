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
 * Privacy provider of the LaserCut Studio activity module.
 *
 * @package    mod_lasercutstudio
 * @copyright  2026 LaserCut Studio
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace mod_lasercutstudio\privacy;

use core_privacy\local\metadata\collection;
use core_privacy\local\request\approved_contextlist;
use core_privacy\local\request\approved_userlist;
use core_privacy\local\request\contextlist;
use core_privacy\local\request\userlist;
use core_privacy\local\request\writer;

defined('MOODLE_INTERNAL') || die();

/**
 * Privacy provider: submissions, files and grades.
 */
class provider implements
    \core_privacy\local\metadata\provider,
    \core_privacy\local\request\core_userlist_provider,
    \core_privacy\local\request\plugin\provider {

    /**
     * Describes the personal data stored by the plugin.
     *
     * @param collection $collection
     * @return collection
     */
    public static function get_metadata(collection $collection): collection {
        $collection->add_database_table('lasercutstudio_submissions', [
            'userid' => 'privacy:metadata:lasercutstudio_submissions:userid',
            'status' => 'privacy:metadata:lasercutstudio_submissions:status',
            'filename' => 'privacy:metadata:lasercutstudio_submissions:filename',
            'objectcount' => 'privacy:metadata:lasercutstudio_submissions:objectcount',
            'comment' => 'privacy:metadata:lasercutstudio_submissions:comment',
            'grade' => 'privacy:metadata:lasercutstudio_submissions:grade',
            'timecreated' => 'privacy:metadata:lasercutstudio_submissions:timecreated',
            'timemodified' => 'privacy:metadata:lasercutstudio_submissions:timemodified',
        ], 'privacy:metadata:lasercutstudio_submissions');

        $collection->add_subsystem_link('core_files', [], 'privacy:metadata:files');
        $collection->add_subsystem_link('core_grade', [], 'privacy:metadata:grades');

        return $collection;
    }

    /**
     * Returns the contexts that contain data of the user.
     *
     * @param int $userid
     * @return contextlist
     */
    public static function get_contexts_for_userid(int $userid): contextlist {
        $contextlist = new contextlist();

        $sql = "SELECT ctx.id
                  FROM {context} ctx
                  JOIN {course_modules} cm ON cm.id = ctx.instanceid AND ctx.contextlevel = :contextlevel
                  JOIN {modules} m ON m.id = cm.module AND m.name = :modname
                  JOIN {lasercutstudio} l ON l.id = cm.instance
                  JOIN {lasercutstudio_submissions} s ON s.lasercutstudioid = l.id
                 WHERE s.userid = :userid";

        $contextlist->add_from_sql($sql, [
            'contextlevel' => CONTEXT_MODULE,
            'modname' => 'lasercutstudio',
            'userid' => $userid,
        ]);

        return $contextlist;
    }

    /**
     * Returns the users that have data in the given context.
     *
     * @param userlist $userlist
     * @return void
     */
    public static function get_users_in_context(userlist $userlist) {
        $context = $userlist->get_context();
        if (!$context instanceof \context_module) {
            return;
        }

        $sql = "SELECT s.userid
                  FROM {course_modules} cm
                  JOIN {modules} m ON m.id = cm.module AND m.name = :modname
                  JOIN {lasercutstudio} l ON l.id = cm.instance
                  JOIN {lasercutstudio_submissions} s ON s.lasercutstudioid = l.id
                 WHERE cm.id = :cmid";

        $userlist->add_from_sql('userid', $sql, ['cmid' => $context->instanceid, 'modname' => 'lasercutstudio']);
    }

    /**
     * Exports the personal data of the user.
     *
     * @param approved_contextlist $contextlist
     * @return void
     */
    public static function export_user_data(approved_contextlist $contextlist) {
        global $DB;

        $userid = (int) $contextlist->get_user()->id;

        foreach ($contextlist->get_contexts() as $context) {
            if (!$context instanceof \context_module) {
                continue;
            }

            $sql = "SELECT s.*
                      FROM {lasercutstudio_submissions} s
                      JOIN {course_modules} cm ON cm.instance = s.lasercutstudioid
                      JOIN {modules} m ON m.id = cm.module AND m.name = :modname
                     WHERE cm.id = :cmid AND s.userid = :userid";

            $records = $DB->get_records_sql($sql, [
                'cmid' => $context->instanceid,
                'modname' => 'lasercutstudio',
                'userid' => $userid,
            ]);

            if (!$records) {
                continue;
            }

            $data = [];
            foreach ($records as $record) {
                $data[] = (object) [
                    'status' => $record->status,
                    'filename' => $record->filename,
                    'objectcount' => $record->objectcount,
                    'comment' => $record->comment,
                    'grade' => $record->grade,
                    'timecreated' => \core_privacy\local\request\transform::datetime($record->timecreated),
                    'timemodified' => \core_privacy\local\request\transform::datetime($record->timemodified),
                ];
            }

            writer::with_context($context)->export_data(
                [get_string('pluginname', 'mod_lasercutstudio')],
                (object) ['submissions' => $data]
            );

            $fs = get_file_storage();
            $files = $fs->get_area_files($context->id, 'mod_lasercutstudio', 'submission', $userid, 'id', false);
            if ($files) {
                writer::with_context($context)->export_area_files(
                    [get_string('pluginname', 'mod_lasercutstudio')],
                    'mod_lasercutstudio',
                    'submission',
                    $userid
                );
            }
        }
    }

    /**
     * Deletes all submissions in the given context.
     *
     * @param \context $context
     * @return void
     */
    public static function delete_data_for_all_users_in_context(\context $context) {
        global $DB;

        if (!$context instanceof \context_module) {
            return;
        }

        $cm = get_coursemodule_from_id('lasercutstudio', $context->instanceid);
        if (!$cm) {
            return;
        }

        $DB->delete_records('lasercutstudio_submissions', ['lasercutstudioid' => $cm->instance]);

        $fs = get_file_storage();
        $fs->delete_area_files($context->id, 'mod_lasercutstudio', 'submission');
    }

    /**
     * Deletes the data of one user.
     *
     * @param approved_contextlist $contextlist
     * @return void
     */
    public static function delete_data_for_user(approved_contextlist $contextlist) {
        global $DB;

        $userid = (int) $contextlist->get_user()->id;
        $fs = get_file_storage();

        foreach ($contextlist->get_contexts() as $context) {
            if (!$context instanceof \context_module) {
                continue;
            }
            $cm = get_coursemodule_from_id('lasercutstudio', $context->instanceid);
            if (!$cm) {
                continue;
            }
            $DB->delete_records('lasercutstudio_submissions', [
                'lasercutstudioid' => $cm->instance,
                'userid' => $userid,
            ]);
            $fs->delete_area_files($context->id, 'mod_lasercutstudio', 'submission', $userid);
        }
    }

    /**
     * Deletes the data of several users.
     *
     * @param approved_userlist $userlist
     * @return void
     */
    public static function delete_data_for_users(approved_userlist $userlist) {
        global $DB;

        $context = $userlist->get_context();
        if (!$context instanceof \context_module) {
            return;
        }

        $cm = get_coursemodule_from_id('lasercutstudio', $context->instanceid);
        if (!$cm) {
            return;
        }

        $userids = $userlist->get_userids();
        if (!$userids) {
            return;
        }

        list($insql, $inparams) = $DB->get_in_or_equal($userids, SQL_PARAMS_NAMED);
        $inparams['instanceid'] = $cm->instance;

        $DB->delete_records_select('lasercutstudio_submissions',
            "lasercutstudioid = :instanceid AND userid $insql", $inparams);

        $fs = get_file_storage();
        foreach ($userids as $userid) {
            $fs->delete_area_files($context->id, 'mod_lasercutstudio', 'submission', (int) $userid);
        }
    }
}
