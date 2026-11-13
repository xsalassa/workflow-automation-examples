"""XLSX writer method extracted from the inspected Cloud Run worker.

This is not the complete HTTP service. Call only with format_file="xlsx".
"""
import xlsxwriter


class generate_excel:
    def genExcelFile(self, excel_data, target_filename, format_file):

        error = ""
        is_error =  False
        status_code = 200
        try:
            if format_file == 'csv':
                workbook = xlsxwriter.Workbook("{0}.csv".format(target_filename))
            else:
                workbook = xlsxwriter.Workbook("{0}.xlsx".format(target_filename))

            worksheet = workbook.add_worksheet("Sheet 1")

            text_format = {'bottom': 1, 'top': 1, 'left': 1, 'right': 1,
                        'font_name': 'Calibri', 'font_size': 10,
                        'align': 'left', 'valign': 'vcenter'}
            num_format = {'bold':0, 'border': 1, 'bottom': 1, 'top': 1, 'left': 1, 'right': 1, 'font_size': 10,
                        'align': 'right', 'valign': 'vcenter', 'num_format': '###,###,###;-###,###,###;0'}

            excel_column = list(range(0,excel_data.shape[1]+1))


            for excel_col, data_col in zip(excel_column,list(excel_data)):
                excel_col = xlsxwriter.utility.xl_col_to_name(excel_col)
                if excel_data["{}".format(data_col)].dtype == "float64" or excel_data["{}".format(data_col)].dtype == "int64":
                    format_write = num_format
                else:
                    format_write = text_format

                worksheet.write('{}1'.format(excel_col), data_col, workbook.add_format(format_write))
                worksheet.write_column('{}2'.format(excel_col), excel_data["{}".format(data_col)].tolist(), workbook.add_format(format_write))
                worksheet.autofilter('A1:{0}1'.format(excel_col))


            worksheet.hide_gridlines(2)
            worksheet.ignore_errors({'number_stored_as_text': 'A1:BA1048576'})

            workbook.close()

            error = ""
            is_error = False

        except Exception as e:
            error = str(e)
            is_error = True
            status_code = 500
            print(error)


        return error, is_error, status_code
